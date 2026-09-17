// Byte-level checks of the terminal layer: the status-line protocol and the
// East-Asian width rules: only Wide/Fullwidth characters count as two columns.
import { Paint, Screen, dwidth, clip } from '../src/lib/screen.mjs';
import { makeChecker } from './_util.mjs';

const { check, eq, summary } = makeChecker();

function mkStream(cols = 80) {
  const chunks = [];
  return { chunks, write(s) { chunks.push(s); }, columns: cols, on() { } };
}

const K = '\r\x1b[K';
const paint = new Paint(false);   // colour off, so raw text can be compared

console.log('--- inline status protocol ---');
{
  const st = mkStream();
  const s = new Screen(st, paint, 'inline');
  s.line('  A'); eq(st.chunks.join(''), '  A\n', 'line with no status writes only the line');
  st.chunks.length = 0;
  s.status('S'); eq(st.chunks.join(''), K + 'S', 'status draws with erase + text');
  st.chunks.length = 0;
  s.status('S'); eq(st.chunks.join(''), '', 'identical status is not redrawn');
  st.chunks.length = 0;
  s.status('T'); eq(st.chunks.join(''), K + 'T', 'changed status redraws');
  st.chunks.length = 0;
  s.line('  B'); eq(st.chunks.join(''), K + '  B\n' + K + 'T', 'line erases, prints, redraws status');
  st.chunks.length = 0;
  s.close(); eq(st.chunks.join(''), K + '\n', 'close erases and ends the line');
}

console.log('\n--- scroll / off styles ---');
{
  const st = mkStream();
  const s = new Screen(st, paint, 'scroll');
  s.status('S'); s.status('S'); s.status('T');
  eq(st.chunks.join(''), 'S\nT\n', 'scroll prints one line per change, never twice');
}
{
  const st = mkStream();
  const s = new Screen(st, paint, 'off');
  s.status('S'); s.line('  A');
  eq(st.chunks.join(''), '  A\n', 'off style never prints a status line');
}

console.log('\n--- clipping to the terminal width ---');
{
  const st = mkStream(10);
  const s = new Screen(st, paint, 'inline');
  s.status('删');
  eq(st.chunks.join(''), K + '删', 'narrow status untouched');
  st.chunks.length = 0;
  s.status('1234567890123');
  eq(st.chunks.join(''), K + '123456789', 'status is clipped to cols-1');
}

console.log('\n--- display width (must match Python east_asian_width W/F) ---');
eq(dwidth('abc'), 3, 'ascii = 1 each');
eq(dwidth('你好'), 4, 'CJK = 2 each');
eq(dwidth('こんにちは'), 10, 'kana = 2 each');
eq(dwidth('…'), 1, 'ellipsis is Ambiguous -> 1');
eq(dwidth('「」'), 4, 'CJK brackets are Wide -> 2');
eq(dwidth('（只读）'), 8, 'fullwidth forms = 2 each (4 chars)');
eq(dwidth('VOCALOID'), 8, 'latin = 1 each');
eq(dwidth('再一次就好'), 10, 'gag bar body');
eq(clip('你好世界', 5), '你好', 'clip stops before exceeding the budget');
eq(clip('abc', 10), 'abc', 'clip leaves short strings alone');
eq(clip('ab', 0), 'ab', 'clip with cols<=0 returns the string');

console.log('\n--- palette (the 256-colour codes from the original) ---');
{
  const pc = new Paint(true);
  eq(pc.tag('x'), '\x1b[38;5;44mx\x1b[0m', 'tag = 38;5;44');
  eq(pc.msg('x'), '\x1b[38;5;51mx\x1b[0m', 'msg = 38;5;51');
  eq(pc.lyric('x'), '\x1b[38;5;231mx\x1b[0m', 'lyric = 38;5;231');
  eq(pc.voice('x'), '\x1b[38;5;222mx\x1b[0m', 'voice = 38;5;222');
  eq(pc.sys('x'), '\x1b[38;5;203mx\x1b[0m', 'sys = 38;5;203');
  eq(pc.note('x'), '\x1b[38;5;170mx\x1b[0m', 'note = 38;5;170');
  eq(pc.dim('x'), '\x1b[38;5;244mx\x1b[0m', 'dim = 38;5;244');
  eq(pc.bar('x'), '\x1b[38;5;48mx\x1b[0m', 'bar = 38;5;48');
  eq(new Paint(false).lyric('x'), 'x', 'colour off = plain text');
}

console.log('\n--- the pinned footer (winget\'s progress bar) ---');
{
  const st = mkStream(60);
  const s = new Screen(st, paint, 'scroll');
  s.line('  A');
  s.footer('\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591  34%');
  eq(st.chunks.join(''), '  A\n' + K + '\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591  34%',
    'footer draws under the current line');
  st.chunks.length = 0;
  s.line('  B');
  eq(st.chunks.join(''), K + '  B\n' + K + '\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591  34%',
    'footer is erased, then redrawn after a scroll');
  st.chunks.length = 0;
  s.footer('\u2588\u2588\u2588\u2588\u2591\u2591\u2591\u2591  34%');
  eq(st.chunks.join(''), '', 'an unchanged footer is not redrawn');
  st.chunks.length = 0;
  s.close();
  eq(st.chunks.join(''), K + '\n', 'close clears the footer');
}
{
  const st = mkStream(60);
  const s = new Screen(st, paint, 'off');
  s.line('  A'); s.footer('\u2588\u2588\u2588\u2588  34%');
  eq(st.chunks.join(''), '  A\n', 'off style draws no footer');
}

console.log('\n--- clip must not count escape sequences ---');
eq(clip('\x1b[42;30mABCDE\x1b[0m', 3), '\x1b[42;30mABC', 'ANSI prefix passes through, not clipped');
eq(clip('\u2588\u2588\u2588\u2588\u2588', 3), '\u2588\u2588\u2588', 'block characters clip by column');

console.log('\n--- the two integrity bars ---');
const { Show } = await import('../src/miku-show.mjs');
const cfg = { SPEED: '1', AUDIO_OFFSET: '0', AUDIO_START: '0', QUIET: '0', COLOR: '0' };
const show = new Show(cfg, {}, null, false, paint, new Screen(mkStream(), paint, 'inline'));
show.total = 249.233;
// NB: the original keeps a 10-*character* body, so "再" (2 columns) makes the
// first step 11 columns wide.  That quirk is reproduced on purpose.
eq(show.gagBar(1, 20), '(2/2) 正在检查包完整性 [再---------]  20%', 'gag bar step 1');
eq(show.gagBar(5, 100), '(2/2) 正在检查包完整性 [再一次就好-----] 100%', 'gag bar final step');
eq(show.bar('(1/2) 正在删除 miku', 0.0, show.stamp(0)),
  '(1/2) 正在删除 miku [----------]   0%  00:00 / 04:09', 'deletion bar at 0%');
eq(show.bar('(1/2) 正在删除 miku', 1.0, show.stamp(249.233)),
  '(1/2) 正在删除 miku [##########] 100%  04:09 / 04:09', 'deletion bar at 100%');
eq(show.bar('x', 0.456), 'x [#####-----]  45%', 'rounding matches Python round()');

summary('terminal layer');
