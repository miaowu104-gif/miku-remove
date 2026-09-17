<#
  miku-voicebank audio player (Windows)

  Plays one audio file through the WPF MediaPlayer and reports its real
  position on stdout, so the show can line its clock up with what is actually
  being heard instead of guessing.

  stdout protocol (one record per line):
    DURATION <seconds>          natural duration, once opened
    READY <unix_ms>             playback has started; <unix_ms> is the wall
                                clock at the moment Play() returned
    POS <unix_ms> <position>    periodic position report
    DONE                        playback finished
    ERROR <text>                could not open/play

  The process is meant to be killed by its parent to stop the music.
#>
param(
  [Parameter(Mandatory = $true)][string]$Path,
  [double]$Start = 0,
  [double]$Volume = 1.0
)

$ErrorActionPreference = 'Stop'

try {
  Add-Type -AssemblyName PresentationCore
  Add-Type -AssemblyName WindowsBase
} catch {
  Write-Output "ERROR assemblies: $($_.Exception.Message)"
  exit 1
}

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Output "ERROR not found: $Path"
  exit 1
}

$state = @{ opened = $false; failed = $false; err = '' }

$player = New-Object System.Windows.Media.MediaPlayer
try { $player.Volume = [Math]::Max(0.0, [Math]::Min(1.0, $Volume)) } catch { }

$player.add_MediaOpened({ $state.opened = $true })
$player.add_MediaFailed({
  param($sender, $e)
  $state.failed = $true
  $state.err = "$($e.ErrorException)"
})

function Pump {
  [System.Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke(
    [System.Action] { }, [System.Windows.Threading.DispatcherPriority]::Background)
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
try {
  $player.Open([uri]$Path)
} catch {
  Write-Output "ERROR open: $($_.Exception.Message)"
  exit 1
}

while (-not $state.opened -and -not $state.failed -and $sw.Elapsed.TotalSeconds -lt 20) {
  Pump
  Start-Sleep -Milliseconds 10
}
if ($state.failed) { Write-Output "ERROR media failed: $($state.err)"; exit 1 }
if (-not $state.opened) { Write-Output 'ERROR timeout opening media'; exit 1 }

$duration = 0.0
try { $duration = $player.NaturalDuration.TimeSpan.TotalSeconds } catch { }
Write-Output ("DURATION {0:F3}" -f $duration)

if ($Start -gt 0) {
  try { $player.Position = [TimeSpan]::FromSeconds($Start) } catch { }
  # let the seek settle before the clock starts
  $t0 = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  while (([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $t0) -lt 150) {
    Pump
    Start-Sleep -Milliseconds 5
  }
}

try {
  $player.Play()
} catch {
  Write-Output "ERROR play: $($_.Exception.Message)"
  exit 1
}
Write-Output ("READY {0}" -f [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
try { [Console]::Out.Flush() } catch { }

while ($true) {
  Pump
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $pos = 0.0
  try { $pos = $player.Position.TotalSeconds } catch { break }
  Write-Output ("POS {0} {1:F4}" -f $now, $pos)
  if ($duration -gt 0 -and $pos -ge ($duration - 0.05)) { break }
  Start-Sleep -Milliseconds 150
}

try { $player.Stop(); $player.Close() } catch { }
Write-Output 'DONE'
