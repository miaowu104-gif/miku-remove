// winget install / uninstall output for the show.
//
// The voicebank is presented as an ordinary Windows package:
//   winget install Miku.Voicebank     registers the 52 components
//   winget uninstall Miku.Voicebank   takes them away again, one every few
//                                     seconds, while the song plays
//
// winget's own wording is used verbatim where it exists ("Found <Name> [<Id>]",
// "Starting package uninstall...", "Successfully installed"); the per-component
// lines are the package's own installer talking.

export const PACKAGE_NAME = 'Miku Voicebank';
export const PACKAGE_ID = 'Miku.Voicebank';
export const PACKAGE_VERSION = '4.0';
export const PUBLISHER = 'Crypton Future Media';
export const COMPONENT_PREFIX = 'miku-voicebank-pack';

/** pack1..packN in the order winget lists them (plain sort: pack10 < pack2). */
export function packNames(count) {
  const names = [];
  for (let i = 1; i <= count; i++) names.push(`${COMPONENT_PREFIX}${i}`);
  names.sort();
  return names;
}

/** Fill columns downwards, the way winget lays out a list. */
export function columnise(items, columns) {
  const rows = Math.ceil(items.length / columns);
  const out = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < columns; c++) {
      const i = c * rows + r;
      if (i < items.length) row.push(items[i]);
    }
    out.push(row);
  }
  return out;
}

/** Column width so a block lines up. */
export function columnWidth(items, pad = 3) {
  let w = 0;
  for (const s of items) w = Math.max(w, s.length);
  return w + pad;
}

/**
 * When component N goes away, as a function of the show clock.
 * One component every total/count seconds; the voicebank itself is last.
 */
export function removalSchedule(count, total) {
  const step = total / count;
  const out = [];
  for (let n = 1; n <= count; n++) out.push({ n, at: (n - 1) * step });
  return out;
}

/**
 * winget's progress bar, pinned to the bottom of the terminal:
 *
 *   ████████████████░░░░░░░░░░░░░░░░  34%
 *
 * Solid blocks, stretched to whatever the terminal width allows.
 */
export function progressParts(pct, cols = 80) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  const suffix = `  ${String(p).padStart(3)}%`;
  const room = Math.max(8, (cols || 80) - suffix.length - 3);
  const filled = Math.round((p / 100) * room);
  return {
    pct: p,
    bar: '\u2588'.repeat(filled) + '\u2591'.repeat(Math.max(0, room - filled)),
    suffix,
  };
}

/** The header winget prints once it has resolved the package. */
export function foundBlock() {
  return [
    `Found ${PACKAGE_NAME} [${PACKAGE_ID}]`,
    `Version: ${PACKAGE_VERSION}`,
    `Publisher: ${PUBLISHER}`,
  ];
}

/** The licence note winget prints for installs from a third-party source. */
export const LICENCE_NOTE = [
  'This application is licensed to you by its owner.',
  'Microsoft is not responsible for, nor does it grant any licenses to, third-party packages.',
];

export const DOWNLOAD_URL = 'https://fms.uiero.com/downloads/Miku.Voicebank.msi';
export const DOWNLOAD_SIZE = '6.62 MB';

/** "Uninstalling miku-voicebank-packN (3.9.0)..." — the installer's own line. */
export function uninstalling(component, version) {
  return `Uninstalling ${component} (${version})...`;
}

export function installing(component, version) {
  return `Installing ${component} (${version})...`;
}
