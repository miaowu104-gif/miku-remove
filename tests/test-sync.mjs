// Live sync test: run the real show from 25 s into the song (the drop into the
// verse is at 25.6 s), timestamp every transcript line, and compare the
// observed gaps against the timeline.
//
// Needs the song in the cache (run `miku-remove.cmd --fetch-audio` first) and
// plays about 20 seconds of audio.
import fs from 'node:fs';
import { ROOT, startShow, loadItems, expectedLine, makeChecker, sleep } from './_util.mjs';

const { check, summary } = makeChecker();
const START = 25;
const RUN_MS = 22000;

const items = loadItems();
const byLine = new Map(items.map((it) => ['  ' + expectedLine(it), it]));

const t0 = Date.now();
const child = startShow(['--start', String(START), '--speed', '1', '--no-install'], { MIKU_FORCE: '1' });

const seen = [];
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const seg = buf.slice(0, i);
    buf = buf.slice(i + 1);
    // a segment looks like "\r\x1b[K<status>\r\x1b[K  <line>"; keep the tail
    const k = seg.lastIndexOf('\r\x1b[K');
    const text = (k >= 0 ? seg.slice(k + 4) : seg).replace(/\x1b\[[0-9;]*m/g, '');
    if (text.trim()) seen.push({ at: (Date.now() - t0) / 1000, text });
  }
});
let err = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => { err += d; });

await sleep(RUN_MS);
try { child.kill('SIGINT'); } catch { }
await new Promise((r) => child.on('close', r));

const matched = [];
let si = 0;
for (const s of seen) {
  for (let j = si; j < items.length; j++) {
    if ('  ' + expectedLine(items[j]) === s.text) {
      matched.push({ ...items[j], at: s.at });
      si = j + 1;
      break;
    }
  }
}

console.log(`ran ${RUN_MS / 1000}s from audio ${START}s; matched ${matched.length} timeline lines`);
if (err.trim()) console.log('stderr: ' + err.trim());

check(matched.length >= 15, 'matched enough lines to measure', `matched ${matched.length}`);
if (matched.length < 2) { summary('live sync'); process.exit(1); }

if (matched[0].t < 26 || matched[0].t > 28) {
  check(false, 'first matched line is near the verse drop',
    `t=${matched[0].t}s (expected ~26.4)`);
} else {
  check(true, 'first matched line is near the verse drop', `t=${matched[0].t}s`);
}

let prev = null;
let maxDrift = 0;
let worst = null;
for (const m of matched) {
  if (!prev) { prev = m; continue; }
  const drift = (m.at - prev.at) - (m.t - prev.t);
  if (Math.abs(drift) > Math.abs(maxDrift)) { maxDrift = drift; worst = m; }
  prev = m;
}
const first = matched[0];
const last = matched[matched.length - 1];
const rate = (last.t - first.t) / (last.at - first.at);

console.log(`  audio span ${(last.t - first.t).toFixed(3)}s / wall span `
  + `${(last.at - first.at).toFixed(3)}s`);
check(Math.abs(maxDrift) < 0.05, 'every gap is within 50 ms of the timeline',
  `max drift ${(maxDrift * 1000).toFixed(1)} ms`
  + (worst ? ` at t=${worst.t}s` : ''));
check(Math.abs(rate - 1) < 0.005, 'audio runs at real time', `rate ${rate.toFixed(4)}`);

summary('live sync');
