// Every start-up switch exists, is documented, and does what the docs say.
// Also guards the two things most likely to drift apart: the flag list in
// --help vs. the flags main() actually reads, and the keys in show.conf vs.
// the built-in defaults.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeChecker, ROOT } from './_util.mjs';
import { DEFAULTS, readConf } from '../src/lib/config.mjs';
import { Paint } from '../src/lib/screen.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { check, eq, summary } = makeChecker();

const SRC = fs.readFileSync(path.join(ROOT, 'src', 'miku-show.mjs'), 'utf8');
const CONF = path.join(ROOT, 'show.conf');

// --------------------------------------------------------------------------
// 1. the help screen lists every flag, and nothing else
// --------------------------------------------------------------------------

/** The flags --help talks about. */
function helpFlags() {
  const m = SRC.match(/const HELP = `([\s\S]*?)`;/);
  if (!m) return null;
  return new Set((m[1].match(/--[a-z][a-z-]*/g) || []));
}

/** The flags main() actually reads, from `args.someName`. */
function usedFlags() {
  const out = new Set();
  for (const m of SRC.matchAll(/\bargs\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
    // --no-winget is stored as args.noWinget, --to-stdout as args.toStdout
    out.add('--' + m[1].replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
  }
  return out;
}

const inHelp = helpFlags();
check(!!inHelp, 'HELP block found');
const used = usedFlags();

if (inHelp) {
  // bare -h is read by hand in parseArgs, and args.h is only its alias
  used.delete('--h');

  const undocumented = [...used].filter((f) => !inHelp.has(f)).sort();
  eq(undocumented, [], 'every flag main() reads is documented');

  const ignored = [...inHelp].filter((f) => !used.has(f)).sort();
  eq(ignored, [], 'every documented flag is actually read');

  for (const f of ['--audio', '--timeline', '--conf', '--offset', '--start',
    '--speed', '--status', '--install-pace', '--no-audio', '--no-winget',
    '--no-install', '--no-color', '--quiet', '--to-stdout', '--force',
    '--fast', '--calibrate', '--check', '--fetch-audio', '--stop-audio',
    '--version', '--help']) {
    check(inHelp.has(f), `--help mentions ${f}`);
  }
}

// --------------------------------------------------------------------------
// 2. the [Y/n]-era bug: -h used to be swallowed as a positional argument
// --------------------------------------------------------------------------

const parseSrc = SRC.slice(SRC.indexOf('function parseArgs'));
check(/a === '-h'/.test(parseSrc), "parseArgs recognises bare '-h'");

// --------------------------------------------------------------------------
// 3. the install pace default, and what it costs in wall-clock time
// --------------------------------------------------------------------------

eq(DEFAULTS.INSTALL_PACE, '30', 'built-in INSTALL_PACE is 30 ms');

const text = fs.readFileSync(CONF, 'utf8');
eq(readConf(CONF).INSTALL_PACE, '30', 'show.conf ships the same 30 ms');

// show.conf documents every default, and agrees with it
const confKeys = new Set(Object.keys(readConf(CONF)));
const defaultKeys = new Set(Object.keys(DEFAULTS));
eq([...defaultKeys].filter((k) => !confKeys.has(k)).sort(), [],
  'show.conf covers every built-in key');
eq([...confKeys].filter((k) => !defaultKeys.has(k)).sort(), [],
  'show.conf has no key the code does not know');
const mismatched = [...confKeys]
  .filter((k) => k !== 'AUDIO_URL')          // the shipped download URL
  .filter((k) => readConf(CONF)[k] !== DEFAULTS[k])
  .sort();
eq(mismatched, [], 'show.conf values match the built-in defaults');

/** Run the install act on its own and report how long it took. */
async function timeInstall(cfg) {
  const lines = [];
  const fake = {
    cols: () => 100,
    line: (s) => lines.push(s),
    status: () => { },
    footer: () => { },
  };
  const { Show } = await import('../src/miku-show.mjs');
  const show = new Show({ ...DEFAULTS, NO_AUDIO: '1', ...cfg }, {}, process.stdout,
    false, new Paint(false), fake);
  const t0 = Date.now();
  await show.installPhase();
  return { ms: Date.now() - t0, lines };
}

const dflt = await timeInstall({});
const steps = (DEFAULTS.PACK_COUNT | 0) + 3;   // + the 3 non-component pauses
check(dflt.lines.length > steps, 'the install act prints every component',
  `${dflt.lines.length} lines`);
check(dflt.ms >= 1200 && dflt.ms <= 2600,
  'default pace keeps the install act near 1.6 s',
  `${dflt.ms} ms for ${steps} pauses`);

const zero = await timeInstall({ INSTALL_PACE: '0' });
check(zero.ms < 300, '--install-pace 0 prints it all at once', `${zero.ms} ms`);

const slow = await timeInstall({ INSTALL_PACE: '120' });
check(slow.ms > dflt.ms * 2, 'a larger pace really does stretch it out',
  `${slow.ms} ms at 120 ms/step`);

const scaled = await timeInstall({ INSTALL_PACE: '300', SPEED: '10' });
check(scaled.ms < 400, 'no artificial waiting once SPEED >= 3 (--fast)',
  `${scaled.ms} ms`);

// --------------------------------------------------------------------------
// 4. --to-stdout really does quiet the pinned footer
// --------------------------------------------------------------------------

const { Screen } = await import('../src/lib/screen.mjs');
function footerBytes(plain) {
  let out = '';
  const s = new Screen({ columns: 80, write: (x) => { out += x; } }, new Paint(false), 'scroll');
  s.plain = plain;
  s.footer('████░░░░ 50%');
  s.line('a lyric');
  return out;
}
check(/\x1b\[K/.test(footerBytes(false)), 'an interactive footer uses cursor tricks');
check(!/\x1b\[K/.test(footerBytes(true)), '--to-stdout writes no cursor tricks');
check(footerBytes(true).includes('a lyric'), '--to-stdout still prints the show');

summary('start-up options');
