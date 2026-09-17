// Lifecycle test: an interrupt must leave no player behind, --stop-audio must
// kill a singer started by someone else, and the signal handler itself must
// stop the music before it gives up.
//
// Plays about 15 seconds of audio.
import { spawnSync } from 'node:child_process';
import { ROOT, SHOW, startShow, findPlayers, makeChecker, sleep } from './_util.mjs';

const { check, summary } = makeChecker();
const waitClose = (child) => new Promise((r) => child.on('close', (code) => r(code)));

console.log('--- interrupt while the song is playing ---');
{
  const child = startShow(['--start', '25', '--speed', '1', '--no-install'], { MIKU_FORCE: '1' });
  await sleep(6000);
  const during = await findPlayers();
  check(during.length >= 1, 'a player is running during the show', `pids=${during.join(',')}`);

  child.kill('SIGINT');
  const code = await waitClose(child);
  await sleep(1500);
  const after = await findPlayers();
  // On Windows child.kill() is TerminateProcess, so the handler does not get a
  // chance and the code is null; a real Ctrl+C in a console goes through the
  // handler and exits 130.  Either way no player may survive.
  check(code === 130 || code === null, 'show process terminated', `code=${code}`);
  check(after.length === 0, 'no player left behind', `pids=${after.join(',') || 'none'}`);
}

console.log('\n--- the signal handler itself (unit) ---');
{
  const { Show } = await import('../src/miku-show.mjs');
  const { Paint, Screen } = await import('../src/lib/screen.mjs');
  const stream = { write() { }, columns: 80, on() { } };
  const paint = new Paint(false);
  const show = new Show({ SPEED: '1', AUDIO_OFFSET: '0', AUDIO_START: '0' },
    {}, null, false, paint, new Screen(stream, paint, 'off'));
  let stopped = 0, killed = 0;
  show.audio = { stop() { stopped++; }, kill() { killed++; }, position() { return 0; } };
  const saved = process.listeners('SIGINT').slice();
  show.installHandlers();
  process.emit('SIGINT');
  check(show.interrupted === true, 'first Ctrl+C marks the show interrupted');
  check(stopped === 1 && killed === 0, 'first Ctrl+C stops the music politely',
    `stop=${stopped} kill=${killed}`);
  process.emit('SIGINT');
  check(killed === 1, 'second Ctrl+C kills the player', `kill=${killed}`);
  process.removeAllListeners('SIGINT');
  for (const l of saved) process.on('SIGINT', l);
}

console.log('\n--- --stop-audio from another process ---');
{
  const child = startShow(['--start', '25', '--speed', '1', '--no-install'], { MIKU_FORCE: '1' });
  await sleep(6000);
  const during = await findPlayers();
  check(during.length >= 1, 'a player is running', `pids=${during.join(',')}`);

  const r = spawnSync(process.execPath, [SHOW, '--stop-audio'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  await sleep(1500);
  const after = await findPlayers();
  check((r.stdout || '').includes('已经停掉还在播放的旧进程'),
    '--stop-audio reports what it killed', JSON.stringify((r.stdout || '').trim()));
  check(after.length === 0, 'player killed by --stop-audio', `pids=${after.join(',') || 'none'}`);

  child.kill('SIGINT');
  await waitClose(child);
  await sleep(500);
}

console.log('\n--- --stop-audio with nothing playing ---');
{
  const r = spawnSync(process.execPath, [SHOW, '--stop-audio'],
    { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
  check((r.stdout || '').trim() === '没有正在播放的 miku-voicebank 进程。',
    'reports nothing playing', JSON.stringify((r.stdout || '').trim()));
}

summary('lifecycle');
