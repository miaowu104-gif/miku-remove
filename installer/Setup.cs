// Miku Voicebank - single-file installer / uninstaller.
//
// One executable, two jobs:
//   * run it from anywhere          -> setup wizard (asks about a desktop shortcut)
//   * run the installed copy        -> the show, then it removes itself
//
// Everything is per-user (HKCU + %LOCALAPPDATA%), so no UAC prompt.
// The show itself is embedded as payload.zip and unpacked on install.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

static class MikuSetup
{
    const string AppName    = "Miku Voicebank";
    const string AppId      = "MikuVoicebank";
    const string AppVersion = "4.0";
    const string Publisher  = "Crypton Future Media";
    const string PayloadRes = "payload.zip";

    static string InstallDir
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", "MikuVoicebank");
        }
    }
    static string ShowCmd      { get { return Path.Combine(InstallDir, "miku-remove.cmd"); } }
    static string LauncherExe  { get { return Path.Combine(InstallDir, "MikuVoicebank.exe"); } }
    static string UninstallKey
    {
        get { return @"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId; }
    }

    [STAThread]
    static void Main(string[] args)
    {
        bool runningInstalled = Application.ExecutablePath.StartsWith(
            InstallDir, StringComparison.OrdinalIgnoreCase);
        bool askUninstall = Array.IndexOf(args, "--uninstall") >= 0;
        bool fast = Array.IndexOf(args, "--fast") >= 0;

        if (runningInstalled || askUninstall) PlayShowAndRemove(fast, runningInstalled);
        else if (Array.IndexOf(args, "--silent") >= 0)
        {
            // unattended install: --silent [--no-desktop]
            bool desktop = Array.IndexOf(args, "--no-desktop") < 0;
            try
            {
                DoInstall(desktop);
                Environment.ExitCode = 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("install failed: " + ex.Message);
                Environment.ExitCode = 1;
            }
        }
        else RunWizard();
    }

    // ----------------------------------------------------------------- setup
    [STAThread]
    static void RunWizard()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Font uiFont;
        try { uiFont = new Font("Microsoft YaHei UI", 9f); }
        catch { uiFont = SystemFonts.MessageBoxFont; }

        var form = new Form();
        form.Text = AppName + " " + AppVersion + " 安装程序";
        form.ClientSize = new Size(470, 296);
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.Font = uiFont;
        form.BackColor = Color.FromArgb(32, 32, 40);
        form.ForeColor = Color.Gainsboro;

        var title = new Label();
        title.Text = "Miku Voicebank " + AppVersion;
        title.Font = new Font(uiFont.FontFamily, 15f, FontStyle.Bold);
        title.ForeColor = Color.FromArgb(120, 235, 235);
        title.SetBounds(24, 20, 420, 30);
        form.Controls.Add(title);

        var body = new Label();
        body.Text =
            "装上去只是 51 块「声库数据」。\n\n" +
            "装完之后，它会出现在「设置 → 应用 → 已安装的应用」里，也会在开始菜单\n" +
            "（以及可选的桌面）放一个 Miku Voicebank 图标。\n\n" +
            "运行那个图标，或者点「卸载」—— 那才是这场演出：\n" +
            "winget 拆掉这块声库，而它把《初音ミクの消失》唱完。";
        body.SetBounds(26, 58, 420, 130);
        body.ForeColor = Color.Silver;
        form.Controls.Add(body);

        var chkDesktop = new CheckBox();
        chkDesktop.Text = "创建桌面快捷方式";
        chkDesktop.Checked = true;
        chkDesktop.SetBounds(28, 196, 300, 24);
        chkDesktop.ForeColor = Color.Gainsboro;
        form.Controls.Add(chkDesktop);

        var chkRun = new CheckBox();
        chkRun.Text = "安装完成后立即看一遍（约 5 分钟）";
        chkRun.Checked = false;
        chkRun.SetBounds(28, 222, 340, 24);
        chkRun.ForeColor = Color.Gainsboro;
        form.Controls.Add(chkRun);

        var btnInstall = new Button();
        btnInstall.Text = "安装";
        btnInstall.SetBounds(270, 254, 84, 28);
        btnInstall.FlatStyle = FlatStyle.System;
        form.Controls.Add(btnInstall);

        var btnCancel = new Button();
        btnCancel.Text = "取消";
        btnCancel.SetBounds(362, 254, 84, 28);
        btnCancel.FlatStyle = FlatStyle.System;
        btnCancel.DialogResult = DialogResult.Cancel;
        form.Controls.Add(btnCancel);

        btnInstall.Click += delegate
        {
            btnInstall.Enabled = false;
            btnCancel.Enabled = false;
            string error = null;
            try
            {
                DoInstall(chkDesktop.Checked);
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }

            if (error != null)
            {
                MessageBox.Show(form,
                    "安装失败：\n\n" + error,
                    AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                btnInstall.Enabled = true;
                btnCancel.Enabled = true;
                return;
            }

            form.Hide();
            MessageBox.Show(form,
                "安装完成。\n\n" +
                "想现在就看的话，到开始菜单（或桌面）运行 Miku Voicebank。\n" +
                "运行它就是卸载 —— 演出结束后程序会自己消失。",
                AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
            form.DialogResult = DialogResult.OK;

            if (chkRun.Checked)
            {
                var psi = new ProcessStartInfo(LauncherExe);
                psi.WorkingDirectory = InstallDir;
                psi.UseShellExecute = true;
                try { Process.Start(psi); } catch { }
            }
        };

        Application.Run(form);
    }

    static void DoInstall(bool desktopShortcut)
    {
        if (!NodeAvailable())
        {
            throw new Exception(
                "找不到 Node.js。\n\n" +
                "演出脚本需要 Node.js 18 或更高版本。\n" +
                "请先从 https://nodejs.org 安装，然后再运行本安装程序。");
        }

        // 1. lay down the show
        if (Directory.Exists(InstallDir))
        {
            try { Directory.Delete(InstallDir, true); } catch { }
        }
        Directory.CreateDirectory(InstallDir);
        ExtractPayload(InstallDir);

        // 2. the installed copy of this exe becomes the "run me" icon
        string self = Application.ExecutablePath;
        File.Copy(self, LauncherExe, true);

        // 3. shortcuts
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            AppName + ".lnk");
        MakeShortcut(startMenu, LauncherExe, InstallDir);
        if (desktopShortcut)
        {
            string desktop = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                AppName + ".lnk");
            MakeShortcut(desktop, LauncherExe, InstallDir);
        }

        // 4. tell Windows about it
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId))
        {
            k.SetValue("DisplayName", AppName);
            k.SetValue("DisplayVersion", AppVersion);
            k.SetValue("Publisher", Publisher);
            k.SetValue("InstallLocation", InstallDir);
            k.SetValue("UninstallString", "\"" + LauncherExe + "\" --uninstall");
            k.SetValue("QuietUninstallString", "\"" + LauncherExe + "\" --uninstall --fast");
            k.SetValue("DisplayIcon", LauncherExe + ",0");
            k.SetValue("NoModify", 1, RegistryValueKind.DWord);
            k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            k.SetValue("EstimatedSize", (int)(DirSizeKb(InstallDir)), RegistryValueKind.DWord);
            k.SetValue("Comments", "《初音未来的消失》，但是 winget uninstall");
        }
    }

    static void ExtractPayload(string target)
    {
        Assembly asm = Assembly.GetExecutingAssembly();
        using (Stream s = asm.GetManifestResourceStream(PayloadRes))
        {
            if (s == null) throw new Exception("安装包损坏：找不到内嵌的演出文件。");
            using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in zip.Entries)
                {
                    string dest = Path.Combine(target, entry.FullName.Replace('/', '\\'));
                    if (entry.FullName.EndsWith("/"))
                    {
                        Directory.CreateDirectory(dest);
                        continue;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    // entries carry their own bytes, so the .cmd stays CRLF
                    entry.ExtractToFile(dest, true);
                }
            }
        }
    }

    static void MakeShortcut(string linkPath, string target, string workDir)
    {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        object shell = Activator.CreateInstance(shellType);
        object lnk = shellType.InvokeMember("CreateShortcut",
            BindingFlags.InvokeMethod, null, shell, new object[] { linkPath });
        Type lnkType = lnk.GetType();
        lnkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { target });
        lnkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { workDir });
        lnkType.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { AppName });
        lnkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { target + ",0" });
        lnkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
    }

    static long DirSizeKb(string dir)
    {
        long total = 0;
        try
        {
            foreach (string f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(f).Length; } catch { }
            }
        }
        catch { }
        return total / 1024;
    }

    static bool NodeAvailable()
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c node --version");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (Process p = Process.Start(psi))
            {
                p.StandardOutput.ReadToEnd();
                p.WaitForExit(10000);
                return p.HasExited && p.ExitCode == 0;
            }
        }
        catch { return false; }
    }

    // ------------------------------------------------------------- uninstall
    static void PlayShowAndRemove(bool fast, bool runningInstalled)
    {
        string cmd = ShowCmd;
        if (File.Exists(cmd))
        {
            var psi = new ProcessStartInfo("cmd.exe");
            psi.Arguments = "/c \"\"" + cmd + "\"" + (fast ? " --fast" : "") + "\"";
            psi.WorkingDirectory = InstallDir;
            psi.UseShellExecute = true;
            try
            {
                using (Process p = Process.Start(psi)) { p.WaitForExit(); }
            }
            catch { }
        }
        else if (runningInstalled)
        {
            MessageBox.Show("找不到演出脚本：\n" + cmd, AppName,
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        CleanUp();
    }

    static void CleanUp()
    {
        // We are running from inside InstallDir, so we cannot delete it here.
        // Hand the job to a detached helper that waits for us to exit.
        // NB: PowerShell registry paths need the drive colon, or Test-Path
        // silently reports false and the key survives.
        string regPath = @"HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\" + AppId;
        string startMenu = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk");
        string desktop = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");

        // Order matters: shortcuts and the registry key are not held open by
        // the running exe, so clear them first.  Only the install directory
        // needs the retry loop - it contains our own exe until we have exited.
        string script =
            "Start-Sleep -Milliseconds 600\r\n" +
            "Remove-Item -LiteralPath '" + startMenu + "' -Force -ErrorAction SilentlyContinue\r\n" +
            "Remove-Item -LiteralPath '" + desktop + "' -Force -ErrorAction SilentlyContinue\r\n" +
            "Remove-Item -Path '" + regPath + "' -Recurse -Force -ErrorAction SilentlyContinue\r\n" +
            "for ($i = 0; $i -lt 60; $i++) {\r\n" +
            "  try {\r\n" +
            "    if (Test-Path -LiteralPath '" + InstallDir + "') {\r\n" +
            "      Remove-Item -LiteralPath '" + InstallDir + "' -Recurse -Force -ErrorAction Stop\r\n" +
            "    }\r\n" +
            "    break\r\n" +
            "  } catch { Start-Sleep -Milliseconds 500 }\r\n" +
            "}\r\n";

        string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var psi = new ProcessStartInfo("powershell.exe",
            "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand " + encoded);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        try { Process.Start(psi); } catch { }
    }
}
