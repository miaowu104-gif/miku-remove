// Miku Voicebank - the icon you click, and the thing the MSI calls to play.
//
// Two jobs:
//
//   (no arguments)   the icon. Running it uninstalls the package - a normal
//                    MSI removal (msiexec /x), whose uninstall sequence runs
//                    the show before deleting anything.
//
//   --play-show      called by the MSI's custom action. msiexec runs without a
//                    console, so the show would be invisible and the [Y/n]
//                    prompt unanswerable; this opens a real console window,
//                    waits for the show, and passes its exit code back. A
//                    non-zero code makes the MSI roll the uninstall back,
//                    which is exactly what "n" at the prompt should do.
//
// Built by installer/msi/build-msi.ps1, which bakes PRODUCTCODE in.

using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

static class Launcher
{
    // Replaced at build time with the package's ProductCode.
    const string ProductCode = "__PRODUCT_CODE__";

    [STAThread]
    static int Main(string[] args)
    {
        if (Array.IndexOf(args, "--play-show") >= 0) return PlayShow();
        return Uninstall();
    }

    /// <summary>The icon: uninstall the package, which plays the show.</summary>
    static int Uninstall()
    {
        string exe = Environment.ExpandEnvironmentVariables(@"%SystemRoot%\System32\msiexec.exe");
        var psi = new ProcessStartInfo(exe);
        // /x = uninstall, /qb = basic UI with a progress bar (msiexec needs
        // *some* UI level for the show's console window to be visible)
        psi.Arguments = "/x " + ProductCode + " /qb";
        psi.UseShellExecute = false;

        try
        {
            using (Process p = Process.Start(psi)) p.WaitForExit();
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "无法启动卸载程序：\n\n" + ex.Message,
                "Miku Voicebank", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    /// <summary>
    /// Run the show in its own console window and wait for it.
    /// "start /wait" is what creates the console - a child process of msiexec
    /// would inherit no console at all, so the show would print into nothing
    /// and nobody could answer the [Y/n] prompt.
    /// </summary>
    static int PlayShow()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string show = Path.Combine(dir, "miku-remove.cmd");
        if (!File.Exists(show)) return 1;

        var psi = new ProcessStartInfo("cmd.exe");
        // start "<title>" /wait cmd.exe /c ""<show>""
        psi.Arguments = "/c start \"Miku Voicebank\" /wait cmd.exe /c \"\"" + show + "\"\"";
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = dir;

        try
        {
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch
        {
            return 1;
        }
    }
}
