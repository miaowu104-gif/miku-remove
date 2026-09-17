// Shared helpers for the self-tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const SHOW = path.join(ROOT, 'src', 'miku-show.mjs');
export const TIMELINE = path.join(ROOT, 'data', 'timeline.tsv');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run the show to completion and capture its output. */
export function runShow(args, opts = {}) {
  const r = spawnSync(process.execPath, [SHOW, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout ?? 900000,
    env: { ...process.env, ...(opts.env || {}) },
    maxBuffer: 64 * 1024 * 1024,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Start the show in the background (for interrupt tests). */
export function startShow(args, env = {}) {
  return spawn(process.execPath, [SHOW, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** The lyric timeline as [{ t, kind, text }]. */
export function loadItems() {
  const items = [];
  for (const raw of fs.readFileSync(TIMELINE, 'utf8').split(/\r?\n/)) {
    if (!raw || raw.startsWith('#')) continue;
    const p = raw.split('\t');
    if (p.length >= 3) items.push({ t: +p[0], kind: p[1], text: p[2] });
  }
  return items;
}

/** The line a timeline item should produce (voice lines get a "> " prefix). */
export const expectedLine = (it) => (it.kind === 'voice' ? '> ' + it.text : it.text);

/** PIDs of WPF players still running our script. */
export function findPlayers() {
  return new Promise((resolve) => {
    let out = '';
    const cmd = "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | "
      + "Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*miku-audio-player*' } | "
      + 'Select-Object -ExpandProperty ProcessId';
    const p = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    p.stdout.on('data', (d) => { out += d.toString(); });
    p.on('close', () => resolve(out.split(/\s+/).map((x) => parseInt(x, 10))
      .filter((n) => Number.isFinite(n) && n > 0)));
    p.on('error', () => resolve([]));
    setTimeout(() => { try { p.kill(); } catch { } resolve([]); }, 8000);
  });
}

export function makeChecker() {
  let pass = 0;
  let fail = 0;
  const check = (ok, label, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
    if (ok) pass++; else fail++;
  };
  const eq = (actual, wanted, label) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(wanted);
    if (a === e) check(true, label);
    else check(false, label, `\n       got      ${a}\n       expected ${e}`);
  };
  const summary = (name) => {
    console.log(`\n${name}: ${pass} passed, ${fail} failed`);
    if (fail) process.exitCode = 1;
    return fail === 0;
  };
  return { check, eq, summary };
}
