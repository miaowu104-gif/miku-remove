// Runs every self-test in order and reports a single result.
//   node tests/run-all.mjs           everything (plays ~40s of audio)
//   node tests/run-all.mjs --quick   skip the tests that need real playback
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const quick = process.argv.includes('--quick');

const suites = [
  ['terminal layer (bytes & widths)', 'test-screen.mjs', false],
  ['full transcript fidelity', 'test-transcript.mjs', false],
  ['the [Y/n] confirm prompt', 'test-confirm.mjs', false],
  ['pause freezes the clock', 'test-pause.mjs', true],
  ['progress style (scroll default)', 'test-style.mjs', true],
  ['live audio sync', 'test-sync.mjs', true],
  ['interrupt & cleanup', 'test-lifecycle.mjs', true],
];

let failed = 0;
for (const [title, file, slow] of suites) {
  if (slow && quick) {
    console.log(`\n=== ${title} — skipped (--quick) ===`);
    continue;
  }
  console.log(`\n=== ${title} ===`);
  const r = spawnSync(process.execPath, [path.join(HERE, file)], {
    cwd: path.resolve(HERE, '..'),
    stdio: 'inherit',
    timeout: 900000,
  });
  if (r.status !== 0) failed++;
}

console.log('\n' + '='.repeat(56));
console.log(failed ? `${failed} suite(s) FAILED` : 'all suites passed');
process.exitCode = failed ? 1 : 0;
