// Configuration: built-in defaults -> the *first* config file that exists ->
// MIKU_* environment variables.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');

export const VERSION = '3.9.0';
export const PACKAGE = 'miku-voicebank';
export const DEFAULT_CONF = path.join(ROOT, 'show.conf');
export const USER_CONF = path.join(APPDATA, PACKAGE, 'show.conf');
export const DATA_DIR = path.join(ROOT, 'data');
export const TIMELINE = path.join(DATA_DIR, 'timeline.tsv');
export const LOCALAPPDATA_DIR = path.join(LOCALAPPDATA, PACKAGE);

export const DEFAULTS = {
  AUDIO: '',                 // local song file; empty = look in the audio dirs
  AUDIO_URL: '',             // ...or fetch it from here
  AUDIO_CACHE: '',           // where the download is kept
  AUDIO_FETCH_TIMEOUT: '30',
  AUDIO_FETCH_RETRIES: '2',
  PLAYER: 'auto',            // auto | windows (kept for config compatibility)
  AUDIO_START: '0',          // where in the file the show begins (seconds)
  AUDIO_OFFSET: '0',         // runtime nudge for every lyric line (seconds)
  AUDIO_VOLUME: '',          // 0-100
  NO_AUDIO: '0',
  // "scroll" prints every progress tick as its own line, e.g.
  // "(1/2) 正在删除 miku [##--] 34%  01:25 / 04:09" scrolling by once a
  // second.  "inline" keeps a single fixed status line at the bottom instead.
  STATUS_STYLE: 'scroll',
  COLOR: '1',
  SPEED: '1.0',              // 1 = real time (testing only)
  FORCE: '0',                // 1 = run the full show even without a terminal
  PACK_COUNT: '51',
  TOTAL_SIZE: '5.4 GiB',
  QUIET: '0',
  KILL_STRAY: '1',
  // On Windows the package manager is winget, and the screen is mostly its
  // output.  The show prints that part itself.  WINGET=0 leaves just the
  // [VOCALOID] lines and the lyrics.
  WINGET: '1',
  // Also act out `winget install Miku.Voicebank` before the removal.
  WINGET_INSTALL: '1',
  // Milliseconds per step of the install phase (one component registered).
  // 54 waits in all, so 30ms ~= 1.6s total.  0 = print it all at once.
  INSTALL_PACE: '30',
};

export function readConf(p) {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    return out;
  }
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim().toUpperCase();
    let v = line.slice(i + 1).trim();
    v = v.replace(/^["']|["']$/g, '');
    out[k] = v;
  }
  return out;
}

/** -> [cfg, confUsed] */
export function loadConfig(explicit) {
  const cfg = { ...DEFAULTS };
  let used = null;
  for (const p of [explicit, process.env.MIKU_CONF, USER_CONF, DEFAULT_CONF]) {
    if (!p) continue;
    let ok = false;
    try { ok = fs.statSync(p).isFile(); } catch { ok = false; }
    if (ok) {
      Object.assign(cfg, readConf(p));
      used = p;
      break;
    }
  }
  for (const k of Object.keys(DEFAULTS)) {
    const env = process.env['MIKU_' + k];
    if (env !== undefined) cfg[k] = env;
  }
  return [cfg, used];
}

export function truthy(v) {
  return ['1', 'yes', 'true', 'on'].includes(String(v).trim().toLowerCase());
}

export function asFloat(v, dflt = 0.0) {
  const n = parseFloat(String(v).trim());
  return Number.isFinite(n) ? n : dflt;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
