<#
  Rebuilds MikuVoicebank-Setup.exe from Setup.cs plus a fresh payload.

  The installer is a single self-contained exe: the show is zipped into
  payload.zip, which is embedded as a resource, so Setup.exe is the only file
  you need to hand to anyone.

  Requires the .NET Framework C# compiler, which ships with Windows.
#>
[CmdletBinding()]
param(
  [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
$Root = Split-Path -Parent $Here

$csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $csc)) { throw '找不到 csc.exe（.NET Framework 的 C# 编译器）' }

Write-Host '1/4  打包演出文件...' -ForegroundColor Cyan
$stage = Join-Path $env:TEMP ('mkvb-payload-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
try {
  foreach ($item in @('miku-remove.cmd', 'show.conf', 'README.md', 'data', 'src', 'tools')) {
    Copy-Item -LiteralPath (Join-Path $Root $item) -Destination $stage -Recurse -Force
  }
  $audio = Join-Path $stage 'audio'
  New-Item -ItemType Directory -Force -Path $audio | Out-Null
  Set-Content -Path (Join-Path $audio '说明.txt') -Encoding UTF8 -Value @"
把任意音频文件放进这个目录，演出就会用它，不用改配置。
支持的扩展名：.flac .wav .ogg .oga .opus .mp3 .m4a .aac
"@

  $zip = Join-Path $Here 'payload.zip'
  if (Test-Path $zip) { Remove-Item -Force $zip }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stage, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
  $kb = [math]::Round((Get-Item $zip).Length / 1KB, 1)
  Write-Host "     payload.zip  $kb KB" -ForegroundColor DarkGray
} finally {
  Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}

Write-Host '2/4  规范化 Setup.cs（UTF-8 BOM + CRLF）...' -ForegroundColor Cyan
# csc reads the source as the ANSI codepage unless there is a BOM, which would
# turn every Chinese string into mojibake.
$cs = Join-Path $Here 'Setup.cs'
$text = [System.IO.File]::ReadAllText($cs, [System.Text.Encoding]::UTF8)
[System.IO.File]::WriteAllText($cs, ($text -replace "`r?`n", "`r`n"),
  (New-Object System.Text.UTF8Encoding($true)))

Write-Host '3/4  编译...' -ForegroundColor Cyan
$out = Join-Path $Here 'MikuVoicebank-Setup.exe'
if (Test-Path $out) { Remove-Item -Force $out }

$compileArgs = @('/nologo', '/target:winexe', '/platform:anycpu')
if ($Configuration -eq 'Release') { $compileArgs += '/optimize+' }
$compileArgs += "/out:$out"
$compileArgs += "/resource:$Here\payload.zip,payload.zip"
$compileArgs += '/r:System.dll'
$compileArgs += '/r:System.Drawing.dll'
$compileArgs += '/r:System.Windows.Forms.dll'
$compileArgs += '/r:System.IO.Compression.dll'
$compileArgs += '/r:System.IO.Compression.FileSystem.dll'
$compileArgs += $cs
& $csc @compileArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) { throw '编译失败' }

Write-Host '4/4  校验...' -ForegroundColor Cyan
$asm = [System.Reflection.Assembly]::LoadFile($out)
$names = $asm.GetManifestResourceNames()
if ($names -notcontains 'payload.zip') { throw '安装包里没有内嵌 payload.zip' }
$stream = $asm.GetManifestResourceStream('payload.zip')
$embedded = $stream.Length
$stream.Close()

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host ''
Write-Host "  完成：$out" -ForegroundColor Green
Write-Host "    Setup.exe    $size KB" -ForegroundColor DarkGray
Write-Host "    内嵌演出文件 $embedded bytes" -ForegroundColor DarkGray
Write-Host ''
