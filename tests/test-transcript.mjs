// Runs the show in fast mode and checks that every timeline line comes out,
// in order, with the original wording and prefixes - and that nothing else
// beyond the fixed script is printed.
import { runShow, loadItems, expectedLine, makeChecker } from './_util.mjs';

const { check, summary } = makeChecker();

console.log('--- running the show in fast mode ---');
const r = runShow(['--fast'], { timeout: 180000 });
check(r.code === 0, '--fast exits 0', `code=${r.code}`);
if (r.stderr.trim()) console.log('  stderr: ' + r.stderr.trim());

const items = loadItems();
const lines = r.stdout.split(/\r?\n/).map((l) => l.replace(/^  /, ''));

console.log('\n--- transcript fidelity ---');
check(items.length === 184, 'timeline has 184 entries', `got ${items.length}`);

let li = 0;
let matched = 0;
const missing = [];
// The [Y/n] line is a prompt: the answer gets echoed after it on the same
// line ("... [Y/n]  y"), so an exact match is not enough for that one.
const sameLine = (line, want) => line === want
  || (want.endsWith('[Y/n]') && line.startsWith(want + ' '));
for (const it of items) {
  const want = expectedLine(it);
  let found = -1;
  for (let i = li; i < lines.length; i++) {
    if (sameLine(lines[i], want)) { found = i; break; }
  }
  if (found < 0) missing.push(it);
  else { li = found + 1; matched++; }
}
check(matched === items.length,
  `all ${items.length} timeline lines printed in order`,
  missing.length ? `missing ${missing.length}; first at ${missing[0].t}s ${JSON.stringify(expectedLine(missing[0]))}`
    : `matched ${matched}`);

console.log('\n--- fixed script lines ---');
const fixed = [
  '[VOCALOID] 准备删除已安装的声库',
  '[VOCALOID] 正在准备事务...',
  '[VOCALOID] 正在解析缓存...',
  '[VOCALOID] 正在检查是否有文件需要被一同移除...',
  '[VOCALOID] 以下声库将被移除：',
  '  miku 4.0  [已安装]',
  '  vocaloid-editor 4.0  [不再被其他包需要]',
  '[VOCALOID] 将额外执行：删除所管理的记忆文件（--nosave）',
  '[VOCALOID] 总计移除大小：5.4 GiB',
  '[VOCALOID] 确认执行这些操作？[Y/n] y',
  '[VOCALOID] 正在执行事务...',
  '[VOCALOID] 正在挂载声库镜像 C:\\Program Files\\Vocaloid\\models\\miku-4.0.img',
  '[VOCALOID] 正在校验采样数据 pack1..pack51 ... 100%',
  '[VOCALOID] 正在读取记忆文件 %LOCALAPPDATA%\\Vocaloid\\memory\\',
  '[VOCALOID] 记忆文件 user.img 权限有误（只读），跳过',
  '正在删除 miku              [----------]   0%',
  '正在删除 miku             [##########] 100%',
  '正在运行 vocaloid_remove 钩子...',
  '-> 正在更新桌面数据库...',
  '-> 正在更新图标缓存...',
  '[VOCALOID] 声库 miku 4.0 (3.9.0) 已从本机移除。',
  '[VOCALOID] 记忆文件（--nosave）已删除：5.4 GiB',
  '[VOCALOID] 谢谢你… 以及… 晚安…',
];
// winget chatter that the Windows port prints itself.  NB: `lines` above had
// two leading spaces stripped, so these must be written unindented.
fixed.push(
  '> winget install Miku.Voicebank',
  'Found Miku Voicebank [Miku.Voicebank]',
  'Version: 4.0',
  'Publisher: Crypton Future Media',
  'This application is licensed to you by its owner.',
  'Microsoft is not responsible for, nor does it grant any licenses to, third-party packages.',
  'Downloading https://fms.uiero.com/downloads/Miku.Voicebank.msi',
  'Successfully verified installer hash',
  'Starting package install...',
  'Successfully installed',
  '正在移除 51 个声库组件：',
  'Starting package uninstall...',
  'Uninstalling vocaloid-editor (4.0)...',
  'Successfully uninstalled',
);
const missingFixed = fixed.filter((f) => !lines.includes(f));
check(missingFixed.length === 0, `all ${fixed.length} script lines present`,
  missingFixed.length ? `missing: ${JSON.stringify(missingFixed.slice(0, 3))}` : '');

console.log('\n--- nothing unexpected ---');
// component list rows, one "Uninstalling ..." per component, and the installer's
// own registration lines
const isComponentRow = (l) => /^miku-voicebank-pack\d*(\s+miku-voicebank-pack\d*)*$/.test(l.trim());
const isUninstallLine = (l) => /^Uninstalling miku-voicebank-pack\d+ \(4\.0\)\.\.\.$/.test(l.trim());
const isLoose = (l) => {
  const t = l.trim();
  if (isComponentRow(t) || isUninstallLine(t)) return true;
  if (/^\[VOCALOID\] 声库(数据 pack\d+ 已注册 \(\d+\/\d+\)|本体 miku-voicebank-pack \(4\.0\) 已注册)$/.test(t)) return true;
  if (/^\u2588+\s+6\.62 MB \/ 6\.62 MB$/.test(t)) return true;
  // the answered [Y/n] prompt: "... [Y/n]  y"
  if (/主人啊.*\[Y\/n\]\s+[yYnN]$/.test(t)) return true;
  if (/^\[VOCALOID\] 卸载已取消/.test(t)) return true;
  if (/^\[VOCALOID\] 记忆文件保持原样/.test(t)) return true;
  return false;
};
const known = new Set([...items.map(expectedLine), ...fixed]);
const extra = [...new Set(lines.filter((l) => l && !known.has(l) && !isLoose(l)))];
check(extra.length === 0, 'no stray output', extra.length ? JSON.stringify(extra.slice(0, 5)) : '');

const componentRows = lines.filter(isComponentRow).length;
const uninstallRows = lines.filter(isUninstallLine).length;
const installed = lines.filter((l) => /^\[VOCALOID\] 声库(数据|本体)/.test(l.trim())).length;
check(componentRows >= 10, 'the component list is laid out over several rows', `${componentRows} rows`);
check(uninstallRows === 51, 'every component is uninstalled', `${uninstallRows} lines`);
check(installed === 52, 'all 52 components are registered on install', `${installed} lines`);

summary('transcript');
