#!/usr/bin/env node
// miku-show — plays 《初音ミクの消失》 while printing a Debian-style package
// removal, one lyric line at a time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Paint, Screen, ensureVtEnabled } from './lib/screen.mjs';
import { loadTimeline } from './lib/timeline.mjs';
import { mediaDuration } from './lib/media.mjs';
import {
  packNames, columnise, columnWidth, removalSchedule, progressParts,
  foundBlock, LICENCE_NOTE, DOWNLOAD_URL, DOWNLOAD_SIZE, uninstalling,
  COMPONENT_PREFIX, PACKAGE_ID, PACKAGE_VERSION,
} from './lib/winget.mjs';
import {
  Audio, resolveAudio, findAudio, cacheDir, urlBasename, stopStrayPlayers,
} from './lib/audio.mjs';
import {
  loadConfig, truthy, asFloat, sleep, VERSION, PACKAGE,
  TIMELINE, USER_CONF, DEFAULT_CONF,
} from './lib/config.mjs';

// --------------------------------------------------------------------------
// the script of the show
// --------------------------------------------------------------------------

const HEADER = [
  ['[VOCALOID] 准备删除已安装的声库', 'msg'],
  ['[VOCALOID] 正在准备事务...', 'msg'],
  ['[VOCALOID] 正在解析缓存...', 'msg'],
  ['[VOCALOID] 正在检查是否有文件需要被一同移除...', 'msg'],
  ['[VOCALOID] 以下声库将被移除：', 'msg'],
  ['  miku 4.0  [已安装]', 'tag'],
  ['  vocaloid-editor 4.0  [不再被其他包需要]', 'tag'],
  ['[VOCALOID] 将额外执行：删除所管理的记忆文件（--nosave）', 'msg'],
  ['[VOCALOID] 总计移除大小：{size}', 'msg'],
  ['[VOCALOID] 确认执行这些操作？[Y/n] y', 'msg'],
  ['[VOCALOID] 正在执行事务...', 'msg'],
];

// printed before the song is fetched; the rest starts the clock at t=0
const HEADER_TOP = HEADER.slice(0, 3);
const HEADER_REST = HEADER.slice(3);

const PRELUDE = [
  '[VOCALOID] 正在挂载声库镜像 C:\\Program Files\\Vocaloid\\models\\miku-4.0.img',
  '[VOCALOID] 正在校验采样数据 pack1..pack{count} ... 100%',
  '[VOCALOID] 正在读取记忆文件 %LOCALAPPDATA%\\Vocaloid\\memory\\',
  '[VOCALOID] 记忆文件 user.img 权限有误（只读），跳过',
];

const EPILOGUE = [
  ['Uninstalling vocaloid-editor (4.0)...', 'msg'],
  ['正在运行 vocaloid_remove 钩子...', 'msg'],
  ['-> 正在更新桌面数据库...', 'msg'],
  ['-> 正在更新图标缓存...', 'msg'],
  ['Successfully uninstalled', 'tag'],
  ['', 'plain'],
  ['[VOCALOID] 声库 miku 4.0 ({ver}) 已从本机移除。', 'msg'],
  ['[VOCALOID] 记忆文件（--nosave）已删除：{size}', 'msg'],
  ['[VOCALOID] 谢谢你… 以及… 晚安…', 'msg'],
];

const GAG = '再一次就好';          // the "just one more time" integrity bar

const STYLE_FN = {
  msg: 'msg', lyric: 'lyric', voice: 'voice', sys: 'sys',
  note: 'note', tag: 'tag', bank: 'tag', dim: 'dim',
};

class Interrupted extends Error { }
class QuitRequested extends Error { }

function pad2(n) { return String(n).padStart(2, '0'); }

// --------------------------------------------------------------------------
// the show
// --------------------------------------------------------------------------

class Show {
  constructor(cfg, args, out, tty, paint, screen) {
    this.cfg = cfg;
    this.args = args;
    this.out = out;
    this.tty = tty;
    this.p = paint;
    this.s = screen;

    this.speed = Math.max(0.01, asFloat(cfg.SPEED, 1.0));
    this.offset = asFloat(cfg.AUDIO_OFFSET, 0.0);
    this.aStart = asFloat(cfg.AUDIO_START, 0.0);
    this.shift = this.offset - this.aStart;   // audio time -> show clock
    this.meta = { start: 0.0, total: 250.0 };
    this.items = [];
    this.audio = null;
    this.audioEnd = null;
    this.cursor = 0;
    this.songStart = 0.0;
    this.total = 250.0;
    this.t0 = Date.now();
    this._hits = 0;
    this.stopEarly = false;
    this.interrupted = false;
    this.quitRequested = false;
    // On Windows the package manager is winget, and the screen is mostly its
    // output; the show prints that part itself.
    this.wingetMode = truthy(cfg.WINGET ?? '1');
    this.wingetInstall = this.wingetMode && truthy(cfg.WINGET_INSTALL ?? '1');
    this.uninstallEvents = [];
    this.packCount = Math.max(1, parseInt(String(cfg.PACK_COUNT ?? '51'), 10) || 51);
  }

  // -- rendering helpers ------------------------------------------------
  log(text, style = 'msg') {
    if (truthy(this.cfg.QUIET)) return;
    const name = STYLE_FN[style];
    const painted = name ? this.p[name](text) : text;
    this.s.line('  ' + painted);
  }

  showLine(kind, text) {
    if (kind === 'lyric') this.log(text, 'lyric');
    else if (kind === 'voice') this.log('> ' + text, 'voice');
    else if (kind === 'sys') this.log(text, 'sys');
    else if (kind === 'note') this.log(text, 'note');
    else this.log(text, 'msg');
  }

  bar(label, pct, clock = '') {
    pct = Math.max(0.0, Math.min(1.0, pct));
    const width = 10;
    const n = Math.round(pct * width);
    let text = `${label} [${'#'.repeat(n)}${'-'.repeat(width - n)}] ${String(Math.trunc(pct * 100)).padStart(3)}%`;
    if (clock) text += '  ' + clock;
    return this.p.bar(text);
  }

  /** The 再一次就好 integrity bar (formatted flat, not through bar()). */
  gagBar(revealed, pct) {
    const body = GAG.slice(0, revealed) + '-'.repeat(10 - revealed);
    return this.p.bar(`(2/2) 正在检查包完整性 [${body}] ${String(pct).padStart(3)}%`);
  }

  stamp(t) {
    t = Math.max(0.0, t);
    const total = Math.max(1.0, this.total);
    return `${pad2(Math.trunc(t / 60))}:${pad2(Math.trunc(t % 60))} / `
      + `${pad2(Math.trunc(total / 60))}:${pad2(Math.trunc(total % 60))}`;
  }

  // -- clock -------------------------------------------------------------
  /** Seconds since playback began, sped up by SPEED. */
  showClock() {
    if (this.audio) {
      const pos = this.audio.position();
      if (pos !== null) return Math.max(0.0, pos - this.aStart) * this.speed;
    }
    return ((Date.now() - this.t0) / 1000) * this.speed;
  }

  /** Position in the song file, in seconds.
   *
   * Feeding the show clock into the progress bar is the same thing only while
   * thing only while AUDIO_START is 0; with --start it goes negative and the
   * bar freezes at 0%.  Mapping back through a_start keeps the bar honest
   * however far into the song playback began. */
  audioTime() {
    if (this.audio) {
      const pos = this.audio.position();
      if (pos !== null) return pos;
    }
    return this.showClock() / this.speed + this.aStart;
  }

  async waitFor(showSeconds, tick) {
    for (;;) {
      if (this.s.broken) throw new Interrupted();
      if (this.interrupted) throw new Interrupted();
      if (this.quitRequested) throw new QuitRequested();
      if (this.stopEarly) return;
      const left = showSeconds - this.showClock();
      if (left <= 0) return;
      if (tick) tick(this.showClock());
      await sleep(Math.min(50, Math.max(0, left * 1000)));
    }
  }

  /** Wait until `audioTime` in the song file (timeline times are audio times). */
  async waitUntil(audioTime, tick) {
    await this.waitFor(audioTime + this.shift, tick);
  }

  // -- interruption ------------------------------------------------------
  installHandlers() {
    const onSig = () => {
      this._hits += 1;
      if (this._hits >= 3) {
        if (this.audio) this.audio.kill();
        cleanupTerminal();
        process.exit(130);
      }
      if (this.audio) {
        if (this._hits === 1) this.audio.stop();
        else this.audio.kill();
      }
      this.interrupted = true;
    };
    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);
    process.on('SIGHUP', onSig);
    // Windows consoles deliver Ctrl+Break as SIGBREAK, and a closing console
    // as SIGHUP; Ctrl+C arrives as SIGINT.
    try { process.on('SIGBREAK', onSig); } catch { }
    process.on('exit', () => { if (this.audio) this.audio.kill(); });
  }

  // -- live calibration --------------------------------------------------
  handleKey(c) {
    if (c === '[') this.offset = Math.round((this.offset - 0.1) * 100) / 100;
    else if (c === ']') this.offset = Math.round((this.offset + 0.1) * 100) / 100;
    else if (c === '{') this.offset = Math.round((this.offset - 1.0) * 100) / 100;
    else if (c === '}') this.offset = Math.round((this.offset + 1.0) * 100) / 100;
    else if (c === 's' || c === '\r' || c === '\n') {
      this.shift = this.offset - this.aStart;
      this.saveOffset();
      this.quitRequested = true;
      return;
    } else if (c === 'q') {
      this.quitRequested = true;
      return;
    } else return;
    this.shift = this.offset - this.aStart;
    const sign = this.offset >= 0 ? '+' : '';
    this.log(`AUDIO_OFFSET = ${sign}${this.offset.toFixed(2)}s   `
      + '（[ ] 微调 0.1s，{ } 调整 1s，s 保存，q 放弃）', 'note');
  }

  saveOffset() {
    const target = USER_CONF;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      let lines = [];
      if (fs.existsSync(target)) {
        lines = fs.readFileSync(target, 'utf8').split(/\r?\n/)
          .filter((ln) => !ln.trim().startsWith('AUDIO_OFFSET'));
      }
      const sign = this.offset >= 0 ? '+' : '';
      lines.push(`AUDIO_OFFSET=${sign}${this.offset.toFixed(2)}`);
      fs.writeFileSync(target, lines.join('\n') + '\n', 'utf8');
      this.log(`已保存到 ${target}`, 'note');
    } catch (e) {
      this.log(`保存失败：${e.message}`, 'sys');
    }
  }

  // -- winget chatter -----------------------------------------------------
  /** The install half: `winget install Miku.Voicebank`, which registers the
   *  voicebank itself and then the 51 voice data packs. */
  async installPhase() {
    const count = this.packCount;
    const pace = Math.max(0, asFloat(this.cfg.INSTALL_PACE, 120));
    const gap = this.speed < 3 ? pace / this.speed : 0;
    const beat = async () => { if (gap) await sleep(gap); };

    this.s.line(this.p.dim(`> winget install ${PACKAGE_ID}`));
    for (const line of foundBlock()) this.s.line(line);
    for (const line of LICENCE_NOTE) this.s.line(line);
    this.s.line(`Downloading ${DOWNLOAD_URL}`);
    const dl = progressParts(100, this.s.cols());
    this.s.line(dl.bar + `  ${DOWNLOAD_SIZE} / ${DOWNLOAD_SIZE}`);
    this.s.line('Successfully verified installer hash');
    this.s.line('Starting package install...');
    await beat();

    // the package registers itself first, then the packs, highest number first
    this.s.line('  [VOCALOID] 声库本体 miku-voicebank-pack (4.0) 已注册');
    await beat();
    for (let i = count; i >= 1; i--) {
      this.log(`[VOCALOID] 声库数据 pack${i} 已注册 (${i}/${count})`, 'msg');
      await beat();
    }
    this.s.line('Successfully installed');
    this.s.line('');
    await beat();
  }

  /** "Uninstalling miku-voicebank-packN (4.0)..." — the package's own line as
   *  winget takes each component away. */
  uninstallComponent(n) {
    this.s.line(uninstalling(`${COMPONENT_PREFIX}${n}`, PACKAGE_VERSION));
  }

  /** What winget prints once it has resolved the package and is about to start
   *  removing it. */
  wingetPreamble() {
    for (const line of foundBlock()) this.s.line(line);
    this.s.line('');
    this.s.line(`正在移除 ${this.packCount} 个声库组件：`);
    const names = packNames(this.packCount);
    const width = columnWidth(names);
    for (const row of columnise(names, 5)) {
      const text = row.map((c) => c.padEnd(width)).join('').replace(/\s+$/, '');
      this.s.line(this.p.pkg(text));
    }
    this.s.line('');
    this.s.line('Starting package uninstall...');
    this.s.footer(this.wingetFooter(0));
  }

  /** winget's block progress bar, pinned to the bottom. */
  wingetFooter(pct) {
    const { bar, suffix } = progressParts(pct, this.s.cols());
    return bar + suffix;
  }

  // -- phases ------------------------------------------------------------
  async sayHello() {
    for (const [text, style] of HEADER_TOP) {
      this.log(text, style);
      await sleep(350 / this.speed);
    }
  }

  fetchProgress(done, total) {
    const mib = (n) => (n / 1048576).toFixed(1);
    if (total) {
      this.setStatus(this.bar('(0/2) 正在获取声库波形', done / total,
        `${mib(done)}/${mib(total)} MiB`));
    } else {
      this.setStatus(this.bar('(0/2) 正在获取声库波形', 0.0, `${mib(done)} MiB`));
    }
  }

  async prelude() {
    const size = String(this.cfg.TOTAL_SIZE ?? '5.4 GiB');
    const count = String(this.cfg.PACK_COUNT ?? '51');
    let t = 0.0;
    for (const [text, style] of HEADER_REST) {
      await this.waitUntil(Math.min(t, Math.max(0.0, this.songStart - 6.0)));
      this.log(text.replace('{size}', size), style);
      t += 0.4;
    }
    // the recording opens with a long intro: the uninstaller keeps working
    const span = (this.songStart - 3.4) - t;
    if (span > 0 && PRELUDE.length) {
      const gap = span / PRELUDE.length;
      for (const text of PRELUDE) {
        t += gap;
        await this.waitUntil(Math.min(t, this.songStart - 3.4));
        this.log(text.replace('{count}', count), 'msg');
      }
    }
    const base = Math.max(t + 0.4, this.songStart - 3.3);
    // the percentages below are the ones this show uses
    for (const [i, [revealed, pct]] of [[1, 20], [2, 60], [3, 80], [5, 100]].entries()) {
      await this.waitUntil(Math.min(base + 0.8 * i, this.songStart - 0.15));
      this.s.status(this.gagBar(revealed, pct));
    }
    await this.waitUntil(this.songStart);
    this.setStatus(this.bar('(1/2) 正在删除 miku', 0.0, this.stamp(0)));
  }

  async deletion() {
    this.log('正在删除 miku              [----------]   0%', 'msg');
    // Merge the lyrics with winget's per-component announcements: that is what
    // makes it look like one component is really removed every ~5 seconds
    // while the song plays.
    const events = [];
    for (let i = this.cursor; i < this.items.length; i++) {
      const [t, kind, text] = this.items[i];
      events.push({ t, kind, text, idx: i });
    }
    for (const ev of this.uninstallEvents) {
      events.push({ t: this.songStart + ev.at, comp: ev.n });
    }
    events.sort((a, b) => a.t - b.t || (a.comp ? 1 : -1));
    for (const ev of events) {
      await this.waitUntil(ev.t, () => this.tick());
      if (this.stopEarly) break;
      if (ev.comp !== undefined) {
        this.uninstallComponent(ev.comp);
      } else {
        this.showLine(ev.kind, ev.text);
        this.cursor = ev.idx + 1;
      }
    }
    if (!this.stopEarly) {
      await this.waitUntil(this.songStart + this.total, () => this.tick());
    }
    this.setStatus(this.bar('正在删除 miku', 1.0, this.stamp(this.total)));
    this.log('正在删除 miku             [##########] 100%', 'msg');
  }

  wingetPercent(done) {
    const p = Math.round((Math.max(0, done) / Math.max(1.0, this.total)) * 100);
    return Math.max(0, Math.min(100, p));
  }

  tick() {
    const done = this.audioTime() - this.songStart;
    this.setStatus(this.bar('正在删除 miku',
      done / Math.max(1.0, this.total), this.stamp(done)));
    if (this.wingetMode) this.s.footer(this.wingetFooter(this.wingetPercent(done)));
  }

  setStatus(text) {
    this.s.status(text);
  }

  async epilogue() {
    const size = String(this.cfg.TOTAL_SIZE ?? '5.4 GiB');
    for (const [tpl, style] of EPILOGUE) {
      const text = tpl.replace('{ver}', VERSION).replace('{size}', size);
      if (!text) { this.s.line(''); continue; }
      this.log(text, style);
      if (this.speed < 3) await sleep(300 / this.speed);
    }
  }

  // -- driver ------------------------------------------------------------
  async attachAudio(audioPath, start) {
    if (truthy(this.cfg.KILL_STRAY ?? '1')) {
      await stopStrayPlayers((m) => this.log(m, 'sys'));
    }
    this.audio = new Audio(audioPath, this.cfg, (m, s) => this.log(m, s ?? 'sys'));
    const ok = await this.audio.start(start);
    if (!ok) { this.audio = null; return; }
    this.aStart = this.audio.actual_start;
    this.shift = this.offset - this.aStart;
    if (this.audio.duration) this.audioEnd = this.audio.duration - this.aStart;
  }

  async run(timelinePath, audioPath) {
    this.installHandlers();
    const { meta, items } = loadTimeline(fs.readFileSync(timelinePath, 'utf8'));
    this.meta = meta;
    this.items = items;
    this.songStart = meta.start ?? 0.0;
    this.total = meta.total ?? 250.0;
    this.uninstallEvents = this.wingetMode ? removalSchedule(this.packCount, this.total) : [];

    if (this.wingetInstall) await this.installPhase();
    if (this.wingetMode) this.wingetPreamble();
    await this.sayHello();
    if (!(truthy(this.cfg.NO_AUDIO) || this.args.noAudio)) {
      const resolved = audioPath || await resolveAudio(
        this.cfg, this.args.audio, (t, s) => this.log(t, s),
        (d, tot) => this.fetchProgress(d, tot));
      if (resolved) await this.attachAudio(resolved, this.aStart);
    }

    this.t0 = Date.now();
    await this.prelude();
    await this.deletion();
    if (this.stopEarly && !truthy(this.cfg.QUIET)) {
      this.log('[VOCALOID] 卸载已经结束了，停止演出。', 'sys');
    }
    await this.epilogue();

    let end = (this.songStart + this.total + 6.0) - this.aStart;   // show clock
    if (this.audioEnd) end = Math.max(end, this.audioEnd + 0.5);
    if (!this.stopEarly) await this.waitFor(end);
    this.s.close();
    if (this.audio) { this.audio.stop(); this.audio.kill(); }
    return 0;
  }
}

// --------------------------------------------------------------------------
// --check, CLI, main
// --------------------------------------------------------------------------

function findTimeline(explicit) {
  for (const p of [explicit, TIMELINE]) {
    if (!p) continue;
    try { if (fs.statSync(p).isFile()) return p; } catch { }
  }
  return null;
}

function printCheck(cfg, timelinePath, audioPath) {
  const w = (s) => process.stdout.write(s + '\n');
  w(`miku-show ${VERSION}   (${PACKAGE} ${VERSION} / Windows)`);
  w(`  config   : ${cfg._conf || '(built-in defaults)'}`);
  w(`  timeline : ${timelinePath || '!! not found'}`);
  if (timelinePath) {
    const { meta, items } = loadTimeline(fs.readFileSync(timelinePath, 'utf8'));
    w(`             ${items.length} lines, music starts at ${meta.start.toFixed(2)}s, `
      + `removal lasts ${meta.total.toFixed(2)}s`);
  }
  const url = String(cfg.AUDIO_URL || '').trim();
  if (audioPath) {
    w(`  audio    : ${audioPath}`);
  } else if (url) {
    w(`  audio    : (还没下载) ${url}`);
    w(`             -> ${path.join(cacheDir(cfg), urlBasename(url))}`);
  } else {
    w('  audio    : !! not found (no local file and AUDIO_URL is empty)');
  }
  if (audioPath) {
    const size = fs.statSync(audioPath).size / 1e6;
    const dur = mediaDuration(audioPath);
    w(`             ${size.toFixed(1)} MB${dur ? `, ${dur.toFixed(1)}s` : ''}`);
  }
  w('  player   : windows (WPF MediaPlayer, position-locked)');
  if (!audioPath && !url) w('  !! no audio: lyrics will print in silence');
  return 0;
}

const HELP = `usage: miku-show [-h] [--audio AUDIO] [--timeline TIMELINE] [--conf CONF]
                 [--offset OFFSET] [--start START] [--speed SPEED]
                 [--status {inline,scroll,off}] [--no-audio] [--no-color]
                 [--fast] [--calibrate] [--check] [--fetch-audio]
                 [--stop-audio] [--quiet] [--to-stdout] [--version]

播放《初音ミクの消失》，同时输出声库删除过程。

options:
  -h, --help           显示这条帮助
  --audio AUDIO        歌曲文件
  --timeline TIMELINE  歌词时间轴 timeline.tsv
  --conf CONF          配置文件
  --offset OFFSET      歌词整体平移秒数
  --start START        从歌曲第几秒开始播放
  --speed SPEED        演出速度倍率（测试用）
  --status {inline,scroll,off}
                       进度条样式
  --no-audio           只打印歌词，不放声音
  --no-winget          不演出 winget 那部分，只留 [VOCALOID] 和歌词
  --no-install         跳过开头的 winget install，直接从 winget uninstall 开始
  --install-pace 毫秒  安装阶段每步的间隔（默认 120，约 12 秒；0 = 一次打完）
  --no-color           关闭颜色
  --fast               一次性全部打印
  --calibrate          边听边用 [ ] { } 调歌词偏移，s 保存
  --check              只报告设置，不做任何改动
  --fetch-audio        只把歌下载到缓存然后退出
  --stop-audio         杀掉还在唱歌的播放器然后退出
  --quiet              尽量少打印
  --to-stdout          即使有终端也写 stdout
  --version            显示版本号
`;

function parseArgs(argv) {
  const args = { _: [] };
  const takesValue = new Set(['audio', 'timeline', 'conf', 'offset', 'start', 'speed',
    'status', 'install-pace']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { args._.push(a); continue; }
    let name = a.slice(2);
    let val = null;
    const eq = name.indexOf('=');
    if (eq >= 0) { val = name.slice(eq + 1); name = name.slice(0, eq); }
    const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (takesValue.has(name)) {
      if (val === null) { val = argv[++i]; }
      if (val === undefined) { process.stderr.write(`miku-show: --${name} 需要一个值\n`); process.exit(2); }
      args[key] = val;
    } else {
      args[key] = val === null ? true : val;
    }
  }
  return args;
}

let savedRawMode = false;
function cleanupTerminal() {
  if (savedRawMode) {
    try { process.stdin.setRawMode(false); } catch { }
  }
}

async function main(argv) {
  const args = parseArgs(argv);

  if (args.help || args.h) { process.stdout.write(HELP); return 0; }
  if (args.version) { process.stdout.write(`miku-show ${VERSION}\n`); return 0; }

  const [cfg, confUsed] = loadConfig(args.conf);
  cfg._conf = confUsed;
  const timelinePath = findTimeline(args.timeline);
  const audioPath = findAudio(cfg, args.audio);

  if (args.offset !== undefined) cfg.AUDIO_OFFSET = String(args.offset);
  if (args.start !== undefined) cfg.AUDIO_START = String(args.start);
  if (args.speed !== undefined) cfg.SPEED = String(args.speed);
  if (args.status) cfg.STATUS_STYLE = args.status;
  if (args.noAudio) cfg.NO_AUDIO = '1';
  if (args.noWinget) cfg.WINGET = '0';
  if (args.noInstall) cfg.WINGET_INSTALL = '0';
  if (args.installPace !== undefined) cfg.INSTALL_PACE = String(args.installPace);
  if (args.quiet) cfg.QUIET = '1';
  if (args.fast) {
    cfg.SPEED = String(Math.max(asFloat(cfg.SPEED, 1.0), 200.0));
    cfg.NO_AUDIO = '1';
    cfg.STATUS_STYLE = 'off';
  }

  if (args.check) return printCheck(cfg, timelinePath, audioPath);

  if (args.fetchAudio) {
    const p = await resolveAudio(cfg, args.audio, (t, s) => {
      if (!truthy(cfg.QUIET)) process.stdout.write('  ' + t + '\n');
    });
    if (p && fs.statSync(p).isFile()) {
      if (!truthy(cfg.QUIET)) {
        process.stdout.write(`${p} (${(fs.statSync(p).size / 1048576).toFixed(1)} MiB)\n`);
      }
      return 0;
    }
    return 1;
  }

  if (args.stopAudio) {
    const killed = await stopStrayPlayers((m) => process.stdout.write(m + '\n'));
    if (!killed.length) {
      process.stdout.write('没有正在播放的 miku-voicebank 进程。\n');
    }
    return 0;
  }

  if (!timelinePath) {
    process.stderr.write('miku-show: timeline.tsv not found\n');
    return 1;
  }

  const out = process.stdout;
  const tty = !!out.isTTY;
  ensureVtEnabled();
  const forced = truthy(cfg.FORCE);
  if (!tty && !forced) {
    // no terminal to draw on: never hold the caller for five minutes
    cfg.SPEED = String(Math.max(asFloat(cfg.SPEED, 1.0), 200.0));
    cfg.NO_AUDIO = '1';
    cfg.STATUS_STYLE = 'off';
  }
  if (!tty || args.noColor || process.env.NO_COLOR) cfg.COLOR = '0';

  const paint = new Paint(truthy(cfg.COLOR));
  const screen = new Screen(out, paint, cfg.STATUS_STYLE || 'inline');
  const show = new Show(cfg, args, out, tty, paint, screen);

  if (args.calibrate) {
    try {
      if (!process.stdin.isTTY) throw new Error('stdin 不是终端');
      process.stdin.setRawMode(true);
      savedRawMode = true;
      process.stdin.resume();
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => {
        for (const ch of c) show.handleKey(ch);
      });
    } catch (e) {
      process.stderr.write(`无法进入校准模式：${e.message}\n`);
    }
  }

  let code = 0;
  try {
    code = await show.run(timelinePath, audioPath);
  } catch (e) {
    if (e instanceof QuitRequested) {
      code = 0;
    } else if (e instanceof Interrupted) {
      if (show.audio) { show.audio.stop(); show.audio.kill(); }
      screen.close();
      code = 130;
    } else {
      if (show.audio) { show.audio.stop(); show.audio.kill(); }
      screen.close();
      throw e;
    }
  } finally {
    if (show.audio) { show.audio.stop(); show.audio.kill(); }
    cleanupTerminal();
  }
  return code;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => {
      cleanupTerminal();
      process.stderr.write(`miku-show: ${e && e.stack ? e.stack : e}\n`);
      process.exitCode = 1;
    });
}

export { main, Show };
