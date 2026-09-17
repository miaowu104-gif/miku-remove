// Miku Voicebank - the icon you click.
//
// Running it uninstalls the package.  That is a normal MSI removal
// (msiexec /x), and the MSI's uninstall sequence runs the show before it
// deletes anything - so there is exactly one place the演出 happens.
//
// Built by installer/msi/build-msi.ps1, which bakes PRODUCTCODE in.

using System;
using System.Diagnostics;
using System.Windows.Forms;

static class Launcher
{
    // Replaced at build time with the package's ProductCode.
    const string ProductCode = "__PRODUCT_CODE__";

    [STAThread]
    static void Main(string[] args)
    {
        bool quiet = Array.IndexOf(args, "--quiet") >= 0;

        string exe = Environment.ExpandEnvironmentVariables(@"%SystemRoot%\System32\msiexec.exe");
        var psi = new ProcessStartInfo(exe);
        // /x = uninstall, /qb = basic UI with a progress bar (msiexec needs
        // *some* UI level for the show's console window to be visible)
        psi.Arguments = "/x " + ProductCode + (quiet ? " /qn" : " /qb");
        psi.UseShellExecute = false;

        try
        {
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "无法启动卸载程序：\n\n" + ex.Message,
                "Miku Voicebank", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
