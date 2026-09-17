// Audio: find / download the song, then play it through the PowerShell WPF
// MediaPlayer bridge and track the *real* playback position for the clock.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ROOT, LOCALAPPDATA_DIR, asFloat, sleep, truthy } from './config.mjs';

const PLAYER_PS1 = path.join(ROOT, 'tools', 'miku-audio-player.ps1');
export const AUDIO_EXT = ['.flac', '.wav', '.ogg', '.oga', '.opus', '.mp3', '.m4a', '.aac'];

export function cacheDir(cfg) {
  const explicit = String(cfg?.AUDIO_CACHE || '').trim();
  if (explicit) return explicit;
  return path.join(LOCALAPPDATA_DIR, 'cache');
}

export function stateDir() {
  const d = path.join(LOCALAPPDATA_DIR, 'run');
  try { fs.mkdirSync(d, { recursive: true }); } catch { }
  return d;
}

export function urlBasename(url) {
  let s = String(url).split('?')[0].split('#')[0];
  s = s.replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  const base = i >= 0 ? s.slice(i + 1) : s;
  return base || 'audio.mp3';
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function scanDir(dir) {
  try {
    const names = fs.readdirSync(dir).sort();
    for (const n of names) {
      if (AUDIO_EXT.includes(path.extname(n).toLowerCase())) return path.join(dir, n);
    }
  } catch { }
  return null;
}

export function findAudio(cfg, explicit) {
  const cands = [];
  if (explicit) cands.push(explicit);
  const a = String(cfg.AUDIO || '').trim();
  if (a) cands.push(a);
  for (const c of cands) {
    if (c && isFile(c)) return c;
  }
  // audio/ next to the project, then anywhere in the cache
  const localDir = path.join(ROOT, 'audio');
  const hitLocal = scanDir(localDir);
  if (hitLocal) return hitLocal;
  const url = String(cfg.AUDIO_URL || '').trim();
  if (url) {
    const dest = path.join(cacheDir(cfg), urlBasename(url));
    if (isFile(dest)) return dest;
  }
  const hitCache = scanDir(cacheDir(cfg));
  return hitCache || null;
}

export async function download(url, dest, log, progress, timeoutSec = 30, retries = 2) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const tmp = dest + '.part';
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': `miku-voicebank/${'3.9.0'}` },
        signal: AbortSignal.timeout(Math.max(1, timeoutSec) * 1000),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
      let done = 0;
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          done += chunk.length;
          if (progress) { try { progress(done, total); } catch { } }
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
      fs.renameSync(tmp, dest);
      return dest;
    } catch (e) {
      lastErr = e;
      try { fs.unlinkSync(tmp); } catch { }
      if (attempt < retries) await sleep(1000);
    }
  }
  throw lastErr || new Error('download failed');
}

export async function resolveAudio(cfg, explicit, log, progress, allowDownload = true) {
  const local = findAudio(cfg, explicit);
  if (local) return local;
  const url = String(cfg.AUDIO_URL || '').trim();
  if (!url || !allowDownload) return null;
  const dest = path.join(cacheDir(cfg), urlBasename(url));
  log(`正在从网络获取声库波形：${url}`, 'msg');
  try {
    await download(url, dest, log, progress,
      asFloat(cfg.AUDIO_FETCH_TIMEOUT, 30),
      Math.max(0, Math.round(asFloat(cfg.AUDIO_FETCH_RETRIES, 2))));
    const mib = fs.statSync(dest).size / 1048576;
    log(`声库波形已就绪：${dest}（${mib.toFixed(1)} MiB）`, 'msg');
    return dest;
  } catch (e) {
    log(`获取声库波形失败：${e.message}`, 'sys');
    return null;
  }
}

// --- stray player cleanup ---------------------------------------------------

export function playerPidPath() {
  return path.join(stateDir(), 'player.pid');
}

function pidLooksLikeOurPlayer(pid) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try {
      p = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue).CommandLine`,
      ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch { resolve(false); return; }
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('error', () => resolve(false));
    p.on('close', () => resolve(out.includes('miku-audio-player.ps1')));
    setTimeout(() => { try { p.kill(); } catch { } resolve(false); }, 5000);
  });
}

/** Ask the OS which processes are running our player right now. */
function scanForPlayers() {
  return new Promise((resolve) => {
    let out = '';
    let p;
    const cmd = "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | "
      + 'Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '
      + "'*miku-audio-player*' } | Select-Object -ExpandProperty ProcessId";
    try {
      p = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd,
      ], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    } catch { resolve([]); return; }
    const done = (v) => resolve(v);
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('error', () => done([]));
    p.on('close', () => done(out.split(/\s+/).map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0)));
    setTimeout(() => { try { p.kill(); } catch { } done([]); }, 8000);
  });
}

export async function stopStrayPlayers(log) {
  const pids = new Set();
  for (const p of await scanForPlayers()) pids.add(p);
  const pidFile = playerPidPath();
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (pid > 0 && pid !== process.pid && !pids.has(pid)) {
      if (await pidLooksLikeOurPlayer(pid)) pids.add(pid);
    }
  } catch { }
  try { fs.unlinkSync(pidFile); } catch { }
  const list = [...pids];
  for (const pid of list) {
    try { process.kill(pid, 'SIGKILL'); } catch { }
  }
  if (list.length && log) log(`已经停掉还在播放的旧进程：${list.join(' ')}`, 'sys');
  return list;
}

// --- the player bridge ------------------------------------------------------

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  if (!n) return null;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

export class Audio {
  constructor(filePath, cfg, log) {
    this.path = filePath;
    this.cfg = cfg;
    this.log = log;
    this.proc = null;
    this.name = 'windows';
    this.actual_start = 0.0;
    this.duration = null;
    this.ready = false;
    this.failed = null;
    this._epochSamples = [];
    this._epoch = null;
    this._buf = '';
    this._readyWaiters = [];
    this._exited = false;
  }

  /**
   * Start playback at `startSeconds` and wait until the first real position
   * report, so the caller's clock matches what is actually being heard.
   * Resolves true on success.
   */
  async start(startSeconds) {
    this.actual_start = startSeconds;
    const vol = String(this.cfg.AUDIO_VOLUME ?? '').trim();
    const volume = vol === '' ? 1.0 : Math.max(0, Math.min(1, asFloat(vol, 100) / 100));

    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA',
      '-File', PLAYER_PS1,
      '-Path', this.path,
      '-Start', String(startSeconds),
      '-Volume', String(volume),
    ];
    try {
      this.proc = spawn('powershell.exe', args, {
        // stdin is the control channel: "pause" / "resume" / "quit"
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch (e) {
      this.failed = e.message;
      this.proc = null;
      return false;
    }

    try { fs.writeFileSync(playerPidPath(), String(this.proc.pid)); } catch { }

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => this._onData(d));
    this.proc.on('error', (e) => { this.failed = e.message; this._wake(); });
    this.proc.on('close', () => { this._exited = true; this._wake(); });

    const deadline = Date.now() + 25000;
    while (!this.ready && !this.failed && !this._exited && Date.now() < deadline) {
      await sleep(20);
    }
    if (this.failed) {
      this.log(`启动播放器失败：${this.failed}`, 'sys');
      this.proc = null;
      return false;
    }
    if (!this.ready) {
      this.log('播放器没有在预期时间内开始播放，本次演出没有声音。', 'sys');
      this.proc = null;
      return false;
    }
    // wait for a position sample so the epoch is measured, not guessed
    const epochDeadline = Date.now() + 3000;
    while (this._epoch === null && !this._exited && Date.now() < epochDeadline) {
      await sleep(10);
    }
    if (this._epoch === null) {
      // no position reports: fall back to the READY wall clock
      this._epoch = this._readyMs - startSeconds * 1000;
    }
    return true;
  }

  _wake() {
    const w = this._readyWaiters;
    this._readyWaiters = [];
    for (const fn of w) fn();
  }

  _onData(chunk) {
    this._buf += chunk;
    let i;
    while ((i = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, i).replace(/\r$/, '');
      this._buf = this._buf.slice(i + 1);
      this._line(line);
    }
  }

  _line(line) {
    if (!line) return;
    const sp = line.indexOf(' ');
    const tag = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1);
    if (tag === 'DURATION') {
      const d = parseFloat(rest);
      if (Number.isFinite(d) && d > 0) this.duration = d;
    } else if (tag === 'READY') {
      this._readyMs = parseInt(rest, 10);
      if (!Number.isFinite(this._readyMs)) this._readyMs = Date.now();
      this.ready = true;
      this._wake();
    } else if (tag === 'POS') {
      const sp2 = rest.indexOf(' ');
      if (sp2 < 0) return;
      const ms = parseInt(rest.slice(0, sp2), 10);
      const pos = parseFloat(rest.slice(sp2 + 1));
      if (!Number.isFinite(ms) || !Number.isFinite(pos)) return;
      // epoch = the wall clock at which file position 0 was heard
      this._epochSamples.push(ms - pos * 1000);
      if (this._epochSamples.length > 24) this._epochSamples.shift();
      // ignore the first couple of samples: the player is still spinning up
      const usable = this._epochSamples.length >= 2
        ? this._epochSamples.slice(1)
        : this._epochSamples;
      this._epoch = median(usable);
    } else if (tag === 'ERROR') {
      this.failed = rest;
      this._wake();
    }
  }

  /** Current position in the audio file, in seconds, or null if unknown. */
  position() {
    if (this._paused) return this._pausedPos;
    if (this._epoch === null) return this._resumePos;
    return (Date.now() - this._epoch) / 1000;
  }

  /** Stop the music where it is.
   *
   * The show's clock is driven by this position, so pausing freezes the whole
   * timeline.  That is what keeps picture and sound together across the [Y/n]
   * prompt: however long the answer takes, the next lyric is still waiting at
   * the right moment in the song.
   *
   * Note this freezes the *reported* position too, not just the player: the
   * position is extrapolated from a fitted epoch rather than read fresh, so
   * without this it would keep climbing while the music stood still.
   */
  pause() {
    this._pausedPos = this.position();
    this._paused = true;
    this._send('pause');
  }

  resume() {
    this._paused = false;
    // Playback resumes at the same file position, but the wall clock has moved
    // on, so every sample gathered before the pause now implies a wrong epoch.
    // Drop them and let the first fresh report re-fit; until then, hold the
    // position we froze at so the clock does not jump.
    this._epochSamples = [];
    this._epoch = null;
    this._resumePos = this._pausedPos;
    this._send('resume');
  }

  _send(cmd) {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) return;
    try { this.proc.stdin.write(cmd + '\n'); } catch { }
  }

  alive() {
    return this.proc !== null && this.proc.exitCode === null && !this._exited;
  }

  stop() {
    if (!this.proc) return;
    try { this.proc.kill(); } catch { }
    this.proc = null;
    try { fs.unlinkSync(playerPidPath()); } catch { }
  }

  kill() {
    this.stop();
  }
}
