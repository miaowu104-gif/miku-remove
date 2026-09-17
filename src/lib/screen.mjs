// Terminal toolkit: 256-colour palette, display-width helpers, and the
// scrolling screen with a live status line and an optional pinned footer.
// Paint / dwidth / clip / Screen.  Timing, palette and wording follow the
// terminal output this show is imitating.

import { spawnSync } from 'node:child_process';

export const RESET = '\x1b[0m';

/** Turn on ENABLE_VIRTUAL_TERMINAL_PROCESSING so the ANSI colours work in
 *  conhost too.  Harmless (and skipped) when the terminal already does it. */
export function ensureVtEnabled() {
  if (process.platform !== 'win32') return;
  if (!process.stdout.isTTY) return;
  if (process.env.MIKU_VT_READY === '1') return;
  const ps = [
    "Add-Type -Namespace MikuVB -Name Native -MemberDefinition '",
    '[DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);',
    '[DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);',
    '[DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);',
    "';",
    '$h=[MikuVB.Native]::GetStdHandle(-11); $m=0;',
    'if([MikuVB.Native]::GetConsoleMode($h,[ref]$m)){[MikuVB.Native]::SetConsoleMode($h,$m -bor 4)|Out-Null}',
  ].join('');
  try {
    spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64'),
    ], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
  } catch { }
}

export class Paint {
  constructor(enabled) {
    this.on = !!enabled;
  }

  _c(code) {
    return this.on ? `\x1b[${code}m` : '';
  }

  _w(code, s) {
    return this.on ? `\x1b[${code}m${s}${RESET}` : s;
  }

  tag(s) { return this._w('38;5;44', s); }    // the [VOCALOID] marker
  msg(s) { return this._w('38;5;51', s); }    // VOCALOID chatter
  lyric(s) { return this._w('38;5;231', s); } // the song
  voice(s) { return this._w('38;5;222', s); } // miku talking to the master
  sys(s) { return this._w('38;5;203', s); }   // deleted files, kill(1)
  note(s) { return this._w('38;5;170', s); }  // section banners
  dim(s) { return this._w('38;5;244', s); }
  bar(s) { return this._w('38;5;48', s); }
  pkg(s) { return this._w('38;5;167', s); }   // component names in a list
}

// --- East Asian Width -------------------------------------------------------
// Only Wide and Fullwidth characters count as two columns, so ambiguous ones
// (…, →, 「) come out one column wide and the bars line up.
function isWide(cp) {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||   // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) ||   // CJK radicals, Kangxi, CJK symbols
    (cp >= 0x3041 && cp <= 0x33ff) ||   // Hiragana .. CJK compatibility
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK unified ideographs
    (cp >= 0xa000 && cp <= 0xa4cf) ||   // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) ||   // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK compatibility ideographs
    (cp >= 0xfe10 && cp <= 0xfe19) ||   // vertical forms
    (cp >= 0xfe30 && cp <= 0xfe6f) ||   // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) ||   // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)    // CJK ext B and beyond
  );
}

const MARK_RE = /\p{M}/u;

export function dwidth(s) {
  let w = 0;
  for (const ch of s) {
    if (MARK_RE.test(ch)) continue;
    w += isWide(ch.codePointAt(0)) ? 2 : 1;
  }
  return w;
}

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/y;

/** Clip to `cols` display columns, passing escape sequences through without
 *  counting them (the coloured footer is longer than it looks). */
export function clip(s, cols) {
  if (cols <= 0) return s;
  let out = '';
  let w = 0;
  let i = 0;
  while (i < s.length) {
    ANSI_RE.lastIndex = i;
    const m = ANSI_RE.exec(s);
    if (m) {
      out += m[0];
      i = ANSI_RE.lastIndex;
      continue;
    }
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const cw = dwidth(ch);
    if (w + cw > cols) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out;
}

export class Screen {
  /** Scrolling lines, one live status line, and an optional pinned footer.
   *
   * `status` is whatever the show wants to keep in view (a progress bar), and
   * in "scroll" style it is printed as its own line every time it changes -
   * that is what "scroll" style does.  `footer` is different: it stays glued
   * to the bottom line and is redrawn after every scroll, so it stays visible
   * while everything else rolls past above it.
   *
   * If the terminal goes away (window closed, pipe reader gone) every write
   * fails; that must never take the removal down with it, so the stream is
   * marked broken and the show ends early.
   */
  constructor(stream, paint, style = 'inline') {
    this.f = stream;
    this.p = paint;
    this.style = style;
    this.broken = false;
    this._status = '';
    this._drawn = false;
    this._footer = '';
    this._footerDrawn = false;
    // "plain" output: no cursor tricks, so the text can be redirected to a
    // file or a pipe without escape sequences moving the caret around.
    this.plain = false;
    if (stream && typeof stream.on === 'function') {
      stream.on('error', () => { this.broken = true; });
    }
  }

  cols() {
    const c = this.f && this.f.columns;
    return Number.isFinite(c) && c > 0 ? c : 100;
  }

  _write(s) {
    if (this.broken) return;
    try {
      this.f.write(s);
    } catch (e) {
      this.broken = true;
    }
  }

  line(s = '') {
    this._erase();
    this._eraseFooter();
    this._write(s + '\n');
    this._draw();
    this._drawFooter();
  }

  /** Write a line but stay on it, so the answer can be typed on the same line.
   *  Pair with finishPrompt(). */
  prompt(s) {
    this._erase();
    this._eraseFooter();
    this._write(s);
    this._drawn = false;
    this._footerDrawn = false;
  }

  /** Finish a prompt: echo what was typed, end the line, restore the footer. */
  finishPrompt(echo = '') {
    this._write(echo + '\n');
    this._draw();
    this._drawFooter();
  }

  status(s) {
    if (s === this._status) {
      // scroll mode prints one line per change, so an unchanged status
      // must not spit out another one
      if (this.style === 'scroll' || this._drawn) return;
    }
    this._status = s;
    if (this.style === 'scroll') {
      this._eraseFooter();
      this._write(s + '\n');
      this._drawFooter();
    } else if (this.style !== 'off') {
      this._draw();
    }
  }

  /** The line pinned to the bottom of the screen (a progress bar). */
  footer(s) {
    if (s === this._footer) return;
    this._footer = s;
    if (this.plain || this.style === 'off' || this.broken) return;
    this._eraseFooter();
    this._drawFooter();
  }

  _erase() {
    if (this._drawn) {
      this._write('\r\x1b[K');
      this._drawn = false;
    }
  }

  _draw() {
    if (!this._status || this.style !== 'inline' || this.broken) return;
    this._write('\r\x1b[K' + clip(this._status, this.cols() - 1));
    this._drawn = true;
  }

  _eraseFooter() {
    if (this._footerDrawn) {
      this._write('\r\x1b[K');
      this._footerDrawn = false;
    }
  }

  _drawFooter() {
    if (this.plain || !this._footer || this.style === 'off' || this.broken) return;
    this._write('\r\x1b[K' + clip(this._footer, this.cols() - 1));
    this._footerDrawn = true;
  }

  close() {
    this._erase();
    this._eraseFooter();
    this._write('\n');
  }
}
