<#
  Builds MikuVoicebank-4.0.msi.

  Three steps:
    1. stage the show into installer\payload\
    2. compile the launcher (installer\msi\Launcher.cs) with the package's
       ProductCode baked in, and drop it into the payload
    3. hand the whole thing to WiX

  Requirements: the .NET Framework C# compiler (ships with Windows) and the
  WiX tool - both are fetched/checked below.
#>
[CmdletBinding()]
param(
  [string]$ProductCode = '{537CFFDE-4DF4-49F1-AEB6-B96FA795ECCB}',
  [string]$Version     = '4.0.0'
)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot                       # installer\msi
$InstallerDir = Split-Path -Parent $Here    # installer
$Root = Split-Path -Parent $InstallerDir    # project root
$Payload = Join-Path $InstallerDir 'payload'
$MsiName = "MikuVoicebank-$($Version.Split('.')[0]).$($Version.Split('.')[1]).msi"
$Msi = Join-Path $InstallerDir $MsiName

function Step($n, $text) { Write-Host "$n  $text" -ForegroundColor Cyan }

# --- 0. tools ---------------------------------------------------------------
Step '0/4' '检查工具链...'
$wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wix) {
  throw "找不到 WiX。装一个：dotnet tool install --global wix --version 5.0.2"
}
$wixVersion = (& wix --version) -replace '\+.*$', ''
Write-Host "     WiX $wixVersion" -ForegroundColor DarkGray

$csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw '找不到 csc.exe' }

# --- 1. payload -------------------------------------------------------------
Step '1/4' '准备演出文件...'
if (Test-Path $Payload) { Remove-Item -Recurse -Force $Payload }
New-Item -ItemType Directory -Force -Path $Payload | Out-Null

foreach ($item in @('miku-remove.cmd', 'show.conf', 'README.md', 'data', 'src', 'tools')) {
  Copy-Item -LiteralPath (Join-Path $Root $item) -Destination $Payload -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Join-Path $Payload 'audio') | Out-Null
Set-Content -Path (Join-Path $Payload 'audio\说明.txt') -Encoding UTF8 -Value @"
把任意音频文件放进这个目录，演出就会用它，不用改配置。
支持的扩展名：.flac .wav .ogg .oga .opus .mp3 .m4a .aac
"@

# --- 2. launcher ------------------------------------------------------------
Step '2/4' '编译启动器（运行它就卸载）...'
$launcherSrc = Join-Path $Here 'Launcher.cs'
$launcherOut = Join-Path $Payload 'MikuVoicebank.exe'

$source = [System.IO.File]::ReadAllText($launcherSrc, [System.Text.Encoding]::UTF8)
if ($source -notmatch '__PRODUCT_CODE__') {
  throw 'Launcher.cs 里找不到 __PRODUCT_CODE__ 占位符'
}
$source = $source.Replace('__PRODUCT_CODE__', $ProductCode)

$tmpSrc = Join-Path $env:TEMP ('MikuLauncher-' + [guid]::NewGuid().ToString('N') + '.cs')
# csc reads the source as the ANSI codepage without a BOM
[System.IO.File]::WriteAllText($tmpSrc, ($source -replace "`r?`n", "`r`n"),
  (New-Object System.Text.UTF8Encoding($true)))
try {
  & $csc /nologo /target:winexe /platform:anycpu /optimize+ "/out:$launcherOut" `
    /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll $tmpSrc
  if ($LASTEXITCODE -ne 0) { throw '启动器编译失败' }
} finally {
  Remove-Item -LiteralPath $tmpSrc -Force -ErrorAction SilentlyContinue
}
Write-Host "     MikuVoicebank.exe  $([math]::Round((Get-Item $launcherOut).Length/1KB,1)) KB" -ForegroundColor DarkGray

$files = (Get-ChildItem $Payload -Recurse -File).Count
Write-Host "     $files 个文件" -ForegroundColor DarkGray

# --- 3. wix build -----------------------------------------------------------
Step '3/4' '构建 MSI...'
if (Test-Path $Msi) { Remove-Item -Force $Msi }
Push-Location $Here
try {
  & wix build Product.wxs -arch x64 -ext WixToolset.UI.wixext `
    -d "Version=$Version" -o $Msi 2>&1 | Out-String | Write-Host
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Msi)) { throw 'MSI 构建失败' }
} finally {
  Pop-Location
}

# --- 4. report --------------------------------------------------------------
Step '4/4' '完成'
$kb = [math]::Round((Get-Item $Msi).Length / 1KB, 1)
Write-Host ''
Write-Host "  $Msi" -ForegroundColor Green
Write-Host "    $MsiName  $kb KB" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  安装：双击，或 msiexec /i "' -NoNewline -ForegroundColor DarkGray
Write-Host $MsiName -NoNewline -ForegroundColor DarkGray
Write-Host '"' -ForegroundColor DarkGray
Write-Host '  静默：msiexec /i ... /qn ADDLOCAL=Main     （不建桌面快捷方式）' -ForegroundColor DarkGray
Write-Host '  卸载：运行安装后的 Miku Voicebank 图标，或在设置里点卸载' -ForegroundColor DarkGray
Write-Host ''
