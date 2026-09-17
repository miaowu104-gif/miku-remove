// Does pausing actually freeze the clock the show runs on?
//
// The show's timeline is derived from Audio.position(), so if pause holds the
// position still, the whole show holds still - which is what keeps the lyrics
// lined up with the song across the [Y/n] prompt.
import { Audio } from '../src/lib/audio.mjs';

const CACHE = process.env.LOCALAPPDATA + '\\miku-voicebank\\cache\\mkrm.mp3';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const audio = new Audio(CACHE, { AUDIO_VOLUME: '0' }, () => { });
const started = await audio.start(60);
if (!started) { console.log('PLAYER FAILED TO START'); process.exit(1); }

const t0 = Date.now();
const samples = [];
const timer = setInterval(() => {
  samples.push({ wall: (Date.now() - t0) / 1000, pos: audio.position() });
}, 100);

await sleep(2000);
const beforePause = audio.position();
audio.pause();
await sleep(3000);
const duringPause = audio.position();
audio.resume();
await sleep(2000);
const afterResume = audio.position();

clearInterval(timer);
audio.stop();

const at = (lo, hi) => samples.filter((s) => s.wall >= lo && s.wall <= hi);

console.log('wall clock -> reported position');
for (const s of samples) {
  const mark = s.wall < 2 ? 'running' : s.wall < 5 ? 'PAUSED ' : 'running';
  console.log(`  ${s.wall.toFixed(1)}s  ${mark}  pos=${s.pos.toFixed(3)}`);
}

console.log('');
console.log(`  position just before pause : ${beforePause.toFixed(3)}`);
console.log(`  position after 3s paused   : ${duringPause.toFixed(3)}`);
console.log(`  position 2s after resume   : ${afterResume.toFixed(3)}`);

const drifted = Math.abs(duringPause - beforePause);
const advanced = afterResume - duringPause;

let bad = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) bad++;
};

console.log('');
check(drifted < 0.05, 'paused playback does not move the clock', `drift ${drifted.toFixed(3)}s`);
check(advanced > 1.0, 'resuming carries on from where it stopped', `advanced ${advanced.toFixed(3)}s`);

// and the real point: the show's own clock must not have run on
const pausedWindow = at(2.2, 4.8).map((s) => s.pos);
const spread = Math.max(...pausedWindow) - Math.min(...pausedWindow);
check(spread < 0.05, 'the whole 3s of waiting costs the show no time',
  `position spread ${spread.toFixed(3)}s`);

process.exit(bad ? 1 : 0);
