// The [Y/n] prompt in the middle of the song.
//
//   y / Y / Enter  -> carry on with the removal
//   n / N          -> stop, and unwind to a rollback (Cancelled -> exit 1602)
//   anything else  -> treated as "no", because guessing "yes" would delete
//                     the program when the answer was not understood
//
// With no terminal to ask on the prompt answers itself "y" and the show runs
// to the end, so scripted and --fast runs never block.
import { Show } from '../src/miku-show.mjs';
import { Paint, Screen } from '../src/lib/screen.mjs';
import { makeChecker } from './_util.mjs';

const { check, summary } = makeChecker();

function makeShow() {
  const chunks = [];
  const stream = { write: (s) => chunks.push(s), columns: 100, on() { } };
  const paint = new Paint(false);
  const show = new Show(
    { SPEED: '1', AUDIO_OFFSET: '0', AUDIO_START: '0', QUIET: '0', COLOR: '0' },
    {}, null, true, paint, new Screen(stream, paint, 'scroll'));
  return { show, chunks };
}

const plain = () => {
  const { show, chunks } = makeShow();
  return { show, text: () => chunks.join('').replace(/\x1b\[[0-9;]*m/g, '') };
};

console.log('--- answers that carry on ---');
for (const [answer, label] of [['y', 'y'], ['Y', 'Y'], ['', 'Enter']]) {
  const { show } = plain();
  show.interactive = () => true;
  show.readOneKey = async () => answer;
  let ok = false;
  try { ok = await show.confirmUninstall(); } catch { ok = false; }
  check(ok === true, `"${label}" continues the removal`);
}

console.log('\n--- answers that stop it ---');
for (const [answer, label] of [['n', 'n'], ['N', 'N'], ['x', 'unrecognised key']]) {
  const { show, text } = plain();
  show.interactive = () => true;
  show.readOneKey = async () => answer;
  let cancelled = false;
  try { await show.confirmUninstall(); } catch (e) { cancelled = e.constructor.name === 'Cancelled'; }
  check(cancelled, `"${label}" stops the removal`, cancelled ? '' : 'did not throw Cancelled');
  if (answer === 'n') {
    check(/卸载已取消/.test(text()), 'it says nothing will be deleted');
    check(/记忆文件保持原样/.test(text()), 'and miku stays');
  }
  check(/\n$/.test(text()), 'the prompt line is closed with a newline');
}

console.log('\n--- with no terminal to ask on ---');
{
  const { show, text } = plain();
  show.interactive = () => false;
  const ok = await show.confirmUninstall();
  check(ok === true, 'answers itself "y" instead of blocking');
  check(text().includes('y'), 'and echoes the answer', JSON.stringify(text().trim()));
  check(/\n$/.test(text()), 'prompt line still closed');
}
{
  // --fast must not wait either
  const chunks = [];
  const stream = { write: (s) => chunks.push(s), columns: 100, on() { } };
  const paint = new Paint(false);
  const show = new Show(
    { SPEED: '200', AUDIO_OFFSET: '0', AUDIO_START: '0', QUIET: '0', COLOR: '0' },
    { fast: true }, null, true, paint, new Screen(stream, paint, 'scroll'));
  show.interactive = () => true;              // even with a terminal...
  show.readOneKey = async () => 'n';          // ...a "no" must not be read
  let ok = false;
  try { ok = await show.confirmUninstall(); } catch { ok = false; }
  check(ok === true, '--fast never waits for an answer');
  check(/\n$/.test(chunks.join('')), 'and still closes the line');
}

summary('confirm prompt');
