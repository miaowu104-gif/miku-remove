# miku-remove (Windows)

**《初音未来的消失》，但是 `winget uninstall`** —— 一个 Windows 命令行演出。

装上去只是 51 块"声库数据"；但在「设置 → 应用」里点一下卸载，它们会被一起清掉，
而卸载的过程会**把歌下载下来、播放，并逐句打印歌词** —— 一个声库被删除时的最后一场演出。

播放器用 Windows 自带的 WPF `MediaPlayer`，并**读取真实播放位置**来对齐歌词，
所以不用额外装任何播放器。

---

## 装成一个 Windows 程序（推荐）

双击 **`MikuVoicebank-4.0.msi`** —— 标准的 Windows Installer 包。

Windows 会问一次管理员权限（MSI 的常规行为），接着是熟悉的向导，**界面是中文的**：
欢迎 → 许可协议 → **自定义安装**（想不要桌面图标就在这里把「桌面快捷方式」取消勾选）→ 安装。

安装会：

- 把演出装到 `C:\Program Files\MikuVoicebank`
- 在开始菜单（以及可选的桌面）放一个 **Miku Voicebank** 图标
- 由 Windows Installer 自己登记到「设置 → 应用 → 已安装的应用」：

```
Miku Voicebank    4.0.0    Crypton Future Media
```

**运行那个图标，或者在设置里点「卸载」—— 那才是这场演出。**
约 5 分钟后歌放完，MSI 才真正删掉文件、快捷方式和注册表项。

> 演出会在一个控制台窗口里跑，别急着关它。卸载时那个窗口就是演出本身。

机器上需要有 **Node.js 18+**（演出脚本就是它跑的）。

### 命令行

MSI 的好处就是这些开关都是系统原生的：

```bat
msiexec /i MikuVoicebank-4.0.msi                      :: 图形向导
msiexec /i MikuVoicebank-4.0.msi /qn                  :: 静默全装
msiexec /i MikuVoicebank-4.0.msi /qn ADDLOCAL=Main    :: 静默，不建桌面快捷方式
msiexec /x MikuVoicebank-4.0.msi                      :: 卸载（照样会演出）
msiexec /x MikuVoicebank-4.0.msi /qn MIKU_SKIP_SHOW=1 :: 卸载但跳过演出
```

`MIKU_SKIP_SHOW=1` 是给自动化用的——正常卸载想看的正是那场演出。

### 改了东西想重新打包

改完 `src\`、`show.conf` 这些之后：

```bat
powershell -ExecutionPolicy Bypass -File installer\msi\build-msi.ps1
```

它会重新打 payload、编译启动器、调 WiX 生成 MSI。需要两样东西：

```bat
dotnet tool install --global wix --version 5.0.2
```

**务必用 5.x**——6 和 7 要求接受 Open Source Maintenance Fee 的 EULA，
不接就报 `WIX7015` 直接罢工。

---

## 直接跑（不安装）

想先看看效果，或者改点东西再跑：

```bat
cd /d E:\1\miku-remove
miku-remove.cmd
```

第一次运行会自动把歌抓到缓存（约 6.6 MiB），然后开始约 **4 分 45 秒**的演出。
之后每次运行都直接用缓存，不再联网。

不想等 5 分钟：

```bat
miku-remove.cmd --fast        :: 一次性把整场演出打完
miku-remove.cmd --check       :: 只报告歌曲 / 时间轴 / 播放器的状态
```

### 需要什么

| 需要 | 说明 |
| --- | --- |
| Windows 10 / 11 | 播放器用系统自带的 WPF `MediaPlayer`，不用装解码器 |
| Node.js 18+ | 演出脚本本身；`miku-remove.cmd` 会检查 `node` 在不在 PATH 里 |
| 网络（仅第一次） | 只在需要下载歌曲时用到；离线可以自己放一个音频文件 |

---

## 命令行

```
miku-remove.cmd [--audio 文件] [--timeline 文件] [--conf 文件]
                [--offset 秒] [--start 秒] [--speed 倍率]
                [--status inline|scroll|off] [--no-audio] [--no-color]
                [--fast] [--calibrate] [--check] [--fetch-audio]
                [--stop-audio] [--quiet] [--to-stdout] [--version]
```

| 开关 | 作用 |
| --- | --- |
| `--audio 文件` | 指定歌曲文件（不指定就用缓存里的） |
| `--offset 秒` | 歌词整体平移，用来微调对齐 |
| `--start 秒` | 从歌曲第几秒开始播（配合 `--speed` 可以快速跳到结尾看） |
| `--speed 倍率` | 演出速度，仅测试用，例如 `--speed 40` |
| `--status` | 进度条样式：`scroll`（默认，每秒一行往上刷）/ `inline` 只有固定在最后一行的一条状态栏 / `off` |
| `--no-audio` | 只打印歌词，不放声音 |
| `--no-winget` | 不演出 winget 那部分，只留 `[VOCALOID]` 和歌词 |
| `--no-install` | 跳过开头的 `winget install`，直接从 `winget uninstall` 开始 |
| `--install-pace 毫秒` | 安装阶段每步的间隔（默认 `120` ≈ 6 秒；`60` ≈ 3 秒；`0` = 一次打完） |
| `--calibrate` | 边听边用 `[` `]` 微调 0.1 秒、`{` `}` 调 1 秒，`s` 保存，`q` 放弃 |
| `--check` | 只报告设置，不改动任何东西 |
| `--fetch-audio` | 只把歌下载到缓存然后退出 |
| `--stop-audio` | 杀掉还在唱歌的播放器然后退出 |
| `--fast` | 等于 `--speed 200 --no-audio --status off` |

**中途停下**：连按 Ctrl+C。第 1 下停掉音乐并退出，第 2 下强杀播放器，第 3 下立刻返回。
直接关掉终端窗口，歌也会跟着停。

---

## 配置

配置写在 `show.conf` 里。个人覆盖放 `%APPDATA%\miku-voicebank\show.conf`，
命令行参数优先，所有键都能用 `MIKU_` 前缀的环境变量覆盖（例如 `MIKU_NO_AUDIO=1`）。

**只读第一个存在的配置文件**，不是层层叠加；顺序是
`--conf` → `MIKU_CONF` → `%APPDATA%\miku-voicebank\show.conf` → 程序目录里的 `show.conf`。

下载缓存默认在 `%LOCALAPPDATA%\miku-voicebank\cache\`。
把任意音频丢进程序目录下的 `audio\` 文件夹，也会被自动找到。

---

## 关于歌曲

**这个项目不分发音频**。第一次需要它的时候，脚本会从 `show.conf` 里配置的地址
下载到本地缓存：

```
AUDIO_URL=https://fms.uiero.com/downloads/mkrm.mp3
```

下载失败不影响演出，只是没有声音，歌词照常打印。

时间轴 `data/timeline.tsv` 是对着这份录音做的（前 25.6 秒是安静的前奏，
25.6 秒处落拍进正歌），**时间已经烘焙在里面，运行时的 `AUDIO_OFFSET` 默认是 0**。

换成别的演奏版本时，先找它的落拍点再算偏移：

```bat
:: 例：小提琴演奏版比这份录音整体晚 2.5 秒
miku-remove.cmd --audio "D:\某处\初音ミクの消失.mp3" --offset 2.5 --calibrate
```

---

## 演出里有什么

屏幕上是 `winget` 安装和卸载一个软件包的完整过程。整场分两步：

**1. 先装上去** —— `winget install Miku.Voicebank`：

```
> winget install Miku.Voicebank
Found Miku Voicebank [Miku.Voicebank]
Version: 4.0
Publisher: Crypton Future Media
This application is licensed to you by its owner.
Microsoft is not responsible for, nor does it grant any licenses to, third-party packages.
Downloading https://fms.uiero.com/downloads/Miku.Voicebank.msi
████████████████████████████████████████████████████████  6.62 MB / 6.62 MB
Successfully verified installer hash
Starting package install...
  [VOCALOID] 声库本体 miku-voicebank-pack (4.0) 已注册
  [VOCALOID] 声库数据 pack51 已注册 (51/51)
  ...
  [VOCALOID] 声库数据 pack1 已注册 (1/51)
Successfully installed
```

**2. 再卸下来** —— `winget uninstall Miku.Voicebank`：

```
Found Miku Voicebank [Miku.Voicebank]
Version: 4.0
Publisher: Crypton Future Media

正在移除 51 个声库组件：
miku-voicebank-pack1    miku-voicebank-pack2    ...（51 个，5 列，红字）
...

Starting package uninstall...
  [VOCALOID] 准备删除已安装的声库
```

然后每 `249.233 / 51 ≈ 4.9` 秒插一行 `Uninstalling miku-voicebank-packN (4.0)...`，
屏幕最底下钉着 winget 的方块进度条，随歌词一点点涨：

```
████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  34%
```

### 中途那句 `[Y/n]` 是真的在问你

歌曲走到 2 分 28 秒左右，会停下来等你：

```
  主人啊..请一定要亲手..结束这一切吧 [Y/n]
```

- 按 **`y`**（或直接回车）—— 接着删，演出继续
- 按 **`n`** —— **停止卸载，什么都不会被删**。演出到此为止，
  MSI 会把整个卸载回滚，Miku Voicebank 原封不动地留在机器上

按一个键就行，不用回车。输入别的字符也按"不删"处理——猜错成 `y`
会把程序删掉，猜错成 `n` 最多是白跑一趟。

用安装包装的版本里，这个 `n` 会让 msiexec 回滚（演出脚本以
`1602` `ERROR_INSTALL_USEREXIT` 退出）。如果是自己 `miku-remove.cmd`
跑的，那就只是当场停下，本来也没有东西会被删。

没有终端可问的时候（`--fast`、输出被重定向），这一句自动回答 `y`，
不会卡住。

整场约 5 分钟。嫌开头的安装过程拖沓就 `--install-pace 60`（约 3 秒）
或者 `--no-install` 直接跳过。

两点说明：

* 演出本身不会真的装或卸载任何东西。只有在通过安装包装好之后点「卸载」时，
  演出放完才会删除自己的文件。
* 扫残留播放进程用「进程命令行匹配 + PID 文件」，不依赖系统内部接口。

细节：整场演出的调度和节奏、256 色配色、两种状态行协议（`inline` 的 `\r\033[K`
擦除重绘，以及 `scroll` 的逐行打印）、东亚字符宽度计算（进度条不会因为中文而抖动）、
`--calibrate` 实时校准。

**默认进度条样式是 `scroll`**：删除进度每秒往上刷一行
（`正在删除 miku [##--------]  34%  01:25 / 04:09`），检查包完整性的
20% / 60% / 80% / 100% 四步也都留在屏幕上。想要底部一条固定状态栏就加 `--status inline`。

播放器 `tools/miku-audio-player.ps1` 用 WPF `MediaPlayer` 放音，并把
**`READY` 墙钟时间和周期性 `POS` 位置**报给 Node 主程序，主程序据此算出
"文件位置 0 是在哪一刻被听到的"，再让歌词对表。实测 22 个歌词间隔的最大误差
**14 ms**，整体速率比 0.9997。

---

## 目录结构

```
miku-remove\
├── miku-remove.cmd         入口（设置 UTF-8 代码页，然后调用 node）
├── show.conf               配置
├── installer\
│   ├── MikuVoicebank-4.0.msi     标准 Windows 安装包（把这个给别人就行）
│   ├── msi\
│   │   ├── Product.wxs           MSI 定义：文件、功能、卸载时演出
│   │   ├── Launcher.cs           快捷方式指向的启动器（运行即卸载）
│   │   ├── license.rtf           向导里的许可页
│   │   ├── guids.txt             固定的 ProductCode / UpgradeCode
│   │   └── build-msi.ps1         改完之后重新生成 MSI
│   └── payload\                  打包进 MSI 的演出文件（构建产物）
├── data\timeline.tsv       歌词时间轴（184 条）
├── src\
│   ├── miku-show.mjs       演出脚本：调度、文案、进度条
│   └── lib\
│       ├── screen.mjs      256 色配色 + 状态行协议 + 显示宽度
│       ├── timeline.mjs    时间轴解析
│       ├── config.mjs      配置加载
│       ├── audio.mjs       找歌 / 下载 / 播放器桥接与时钟
│       ├── media.mjs       不依赖解码器的时长探测
│       └── winget.mjs      winget install / uninstall 那部分的输出
├── tools\
│   └── miku-audio-player.ps1   WPF MediaPlayer 播放器（上报真实位置）
└── tests\                  自检脚本
```

跑一遍自检：

```bat
node tests\run-all.mjs
```

`--check` 也能一眼看出歌曲、时间轴、播放器是不是都就位。

### 装完之后想彻底删掉

正常走「设置 → 应用 → 卸载」就行。要是演出中途把窗口关了、只删了一半：

```bat
rmdir /s /q "%LOCALAPPDATA%\Programs\MikuVoicebank"
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\MikuVoicebank" /f
```

---

## 版权 / 免责

《初音ミクの消失》版权属于 cosMo@暴走P，声音属于 Crypton Future Media。
本项目**不含任何音频**，只在运行时从可配置的地址获取；歌词文本用于这个玩梗项目。
请自己买碟、别传播音频。这是一个给同好录视频用的玩具，别拿去干正经事。
