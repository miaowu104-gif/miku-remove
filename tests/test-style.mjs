// Checks the default progress style: every tick on its own line, seconds
// climbing, and all four "检查包完整性" steps visible.
//
// Plays about 14 seconds of audio.
import { startShow, makeChecker, sleep } from './_util.mjs';

const { check, summary } = makeChecker();

const collected = [];
const child = startShow(['--start', '18', '--speed', '1', '--no-install'], { MIKU_FORCE: '1' });
let buf = '';
let raw = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  raw += d;
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const seg = buf.slice(0, i);
    buf = buf.slice(i + 1);
    const k = seg.lastIndexOf('\r\x1b[K');
    const text = (k >= 0 ? seg.slice(k + 4) : seg).replace(/\x1b\[[0-9;]*m/g, '');
    if (text.trim()) collected.push(text);
  }
});

await sleep(18000);
try { child.kill('SIGINT'); } catch { }
await new Promise((r) => child.on('close', r));

console.log(`captured ${collected.length} lines\n`);

const gag = collected.filter((l) => /正在检查包完整性/.test(l));
console.log('--- 检查包完整性 steps ---');
for (const g of gag) console.log('  ' + JSON.stringify(g));
check(gag.length === 4, 'all four integrity steps are printed', `got ${gag.length}`);
check(gag.some((l) => /\]\s+20%/.test(l)), 'includes the 20% step');
check(gag.some((l) => /再一次就好-----\] 100%/.test(l)), 'ends on [再一次就好-----] 100%');

const bars = collected.filter((l) => /^正在删除 miku \[/.test(l));
console.log('\n--- deletion progress lines (every tick, no indent) ---');
for (const b of bars.slice(0, 12)) console.log('  ' + JSON.stringify(b));
check(bars.length >= 5, 'deletion progress scrolls as separate lines', `got ${bars.length}`);

const clocks = bars.map((l) => {
  const m = /(\d\d):(\d\d) \/ /.exec(l);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}).filter((x) => x !== null);
const increasing = clocks.every((c, i) => i === 0 || c === clocks[i - 1] || c === clocks[i - 1] + 1);
check(clocks.length >= 4 && increasing,
  'the clock on those lines climbs one second at a time',
  clocks.length ? clocks.join(',') : 'no clocks parsed');
check(clocks.length < 2 || clocks[clocks.length - 1] > clocks[0],
  'the clock actually advances', `${clocks[0]} -> ${clocks[clocks.length - 1]}`);

// winget's bar lives in a pinned footer, so it is drawn with a carriage
// return rather than a newline; look for it in the raw byte stream.
const footers = raw.match(/[\u2588\u2591]+\s+\d+%/g) || [];
check(footers.length > 0, 'winget footer is pinned to the bottom', `${footers.length} draws`);
const fpcts = footers.map((f) => parseInt(/(\d+)%/.exec(f)[1], 10));
check(fpcts.length > 1 && fpcts[fpcts.length - 1] >= fpcts[0],
  'winget footer percentage climbs', `${fpcts[0]}% -> ${fpcts[fpcts.length - 1]}%`);
check(/\r\x1b\[K/.test(raw), 'footer uses erase-and-redraw, not newlines');

summary('progress style');
