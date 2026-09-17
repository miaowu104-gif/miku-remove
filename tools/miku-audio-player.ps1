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

# --- control channel --------------------------------------------------------
# The parent writes one command per line on our stdin:
#   pause   stop the music where it is
#   resume  carry on from there
#   quit    stop and exit
# While paused we stop reporting POS: the parent fits its clock from
# (wall clock, position) pairs, and a paused player would hand it pairs where
# the position stands still while the clock runs, which would corrupt it.
$stdin = $null
$readBuf = New-Object byte[] 32
$pendingRead = $null
try { $stdin = [Console]::OpenStandardInput() } catch { }
$paused = $false

function PollCommand {
  if ($null -eq $stdin) { return $null }
  if ($null -eq $script:pendingRead) {
    try {
      $script:pendingRead = $stdin.BeginRead($readBuf, 0, $readBuf.Length, $null, $null)
    } catch { $script:stdin = $null; return $null }
  }
  if (-not $script:pendingRead.IsCompleted) { return $null }
  $n = 0
  try { $n = $stdin.EndRead($script:pendingRead) } catch { }
  $script:pendingRead = $null
  if ($n -le 0) { $script:stdin = $null; return $null }
  return [System.Text.Encoding]::ASCII.GetString($readBuf, 0, $n).Trim()
}

while ($true) {
  Pump

  $cmd = PollCommand
  if ($cmd) {
    foreach ($one in ($cmd -split "`n")) {
      switch ($one.Trim().ToLower()) {
        'pause' {
          if (-not $paused) { try { $player.Pause() } catch { }; $paused = $true }
        }
        'resume' {
          if ($paused) { try { $player.Play() } catch { }; $paused = $false }
        }
        'quit' { $paused = $false; break }
      }
    }
    if ($cmd -match 'quit') { break }
  }

  if (-not $paused) {
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $pos = 0.0
    try { $pos = $player.Position.TotalSeconds } catch { break }
    Write-Output ("POS {0} {1:F4}" -f $now, $pos)
    if ($duration -gt 0 -and $pos -ge ($duration - 0.05)) { break }
  }
  Start-Sleep -Milliseconds 150
}

try { $player.Stop(); $player.Close() } catch { }
Write-Output 'DONE'
