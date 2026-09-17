// Lyric timeline: "# start 25.600 / # total 249.233" header plus
// "t_enter <TAB> kind <TAB> text" rows. Times are *audio file* times.

export function loadTimeline(text) {
  const meta = { start: 0.0, total: 250.0 };
  const items = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\n$/, '');
    if (!line) continue;
    if (line.startsWith('#')) {
      // "audio offset" is the generated-file name for the same value as "start"
      const m = /^#\s*(start|total|audio offset)\s*:?\s+([-+0-9.]+)/.exec(line);
      if (m) {
        const key = m[1] === 'audio offset' ? 'start' : m[1];
        meta[key] = parseFloat(m[2]);
      }
      continue;
    }
    const parts = line.split('\t');
    if (parts.length >= 3) {
      items.push([parseFloat(parts[0]), parts[1], parts[2]]);
    }
  }
  return { meta, items };
}
