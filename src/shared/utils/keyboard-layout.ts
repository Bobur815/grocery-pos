// Keyboard-layout-proof scanner input + recovery of codes already corrupted by it.
//
// WHY THIS EXISTS
// A USB barcode/QR scanner is an HID keyboard: it sends *physical key positions* (US-QWERTY),
// and the OS turns those into characters using whatever input language is active. With a
// Cyrillic (Russian) layout active, the scanner's keystroke for `Q` is rendered as `Й`, etc.
// — so alphanumeric GS1 DataMatrix marking codes get mangled. Digits survive (the number row
// is identical across layouts), which is why plain EAN-13 barcodes still scan correctly while
// 022-group marking QR codes do not.
//
// Because the corruption is a deterministic "Russian layout applied to US key positions"
// substitution, it is both (a) preventable at scan time by reading the *physical* key
// (`KeyboardEvent.code`) instead of the language-mapped `key`, and (b) reversible after the
// fact. Both the live POS handler and the recovery script import from this one table so the
// forward and inverse mappings can never drift apart.

// Per physical key (KeyboardEvent.code): the ASCII char a US-QWERTY layout produces and the
// char the standard Windows Russian (ЙЦУКЕН) layout produces, each as [unshifted, shifted].
type Row = {
  code: string;
  us: [string, string];
  ru: [string, string];
};

const LAYOUT: Row[] = [
  // number row
  { code: 'Backquote', us: ['`', '~'], ru: ['ё', 'Ё'] },
  { code: 'Digit1', us: ['1', '!'], ru: ['1', '!'] },
  { code: 'Digit2', us: ['2', '@'], ru: ['2', '"'] },
  { code: 'Digit3', us: ['3', '#'], ru: ['3', '№'] },
  { code: 'Digit4', us: ['4', '$'], ru: ['4', ';'] },
  { code: 'Digit5', us: ['5', '%'], ru: ['5', '%'] },
  { code: 'Digit6', us: ['6', '^'], ru: ['6', ':'] },
  { code: 'Digit7', us: ['7', '&'], ru: ['7', '?'] },
  { code: 'Digit8', us: ['8', '*'], ru: ['8', '*'] },
  { code: 'Digit9', us: ['9', '('], ru: ['9', '('] },
  { code: 'Digit0', us: ['0', ')'], ru: ['0', ')'] },
  { code: 'Minus', us: ['-', '_'], ru: ['-', '_'] },
  { code: 'Equal', us: ['=', '+'], ru: ['=', '+'] },
  // top letter row
  { code: 'KeyQ', us: ['q', 'Q'], ru: ['й', 'Й'] },
  { code: 'KeyW', us: ['w', 'W'], ru: ['ц', 'Ц'] },
  { code: 'KeyE', us: ['e', 'E'], ru: ['у', 'У'] },
  { code: 'KeyR', us: ['r', 'R'], ru: ['к', 'К'] },
  { code: 'KeyT', us: ['t', 'T'], ru: ['е', 'Е'] },
  { code: 'KeyY', us: ['y', 'Y'], ru: ['н', 'Н'] },
  { code: 'KeyU', us: ['u', 'U'], ru: ['г', 'Г'] },
  { code: 'KeyI', us: ['i', 'I'], ru: ['ш', 'Ш'] },
  { code: 'KeyO', us: ['o', 'O'], ru: ['щ', 'Щ'] },
  { code: 'KeyP', us: ['p', 'P'], ru: ['з', 'З'] },
  { code: 'BracketLeft', us: ['[', '{'], ru: ['х', 'Х'] },
  { code: 'BracketRight', us: [']', '}'], ru: ['ъ', 'Ъ'] },
  { code: 'Backslash', us: ['\\', '|'], ru: ['\\', '/'] },
  // home row
  { code: 'KeyA', us: ['a', 'A'], ru: ['ф', 'Ф'] },
  { code: 'KeyS', us: ['s', 'S'], ru: ['ы', 'Ы'] },
  { code: 'KeyD', us: ['d', 'D'], ru: ['в', 'В'] },
  { code: 'KeyF', us: ['f', 'F'], ru: ['а', 'А'] },
  { code: 'KeyG', us: ['g', 'G'], ru: ['п', 'П'] },
  { code: 'KeyH', us: ['h', 'H'], ru: ['р', 'Р'] },
  { code: 'KeyJ', us: ['j', 'J'], ru: ['о', 'О'] },
  { code: 'KeyK', us: ['k', 'K'], ru: ['л', 'Л'] },
  { code: 'KeyL', us: ['l', 'L'], ru: ['д', 'Д'] },
  { code: 'Semicolon', us: [';', ':'], ru: ['ж', 'Ж'] },
  { code: 'Quote', us: ["'", '"'], ru: ['э', 'Э'] },
  // bottom row
  { code: 'KeyZ', us: ['z', 'Z'], ru: ['я', 'Я'] },
  { code: 'KeyX', us: ['x', 'X'], ru: ['ч', 'Ч'] },
  { code: 'KeyC', us: ['c', 'C'], ru: ['с', 'С'] },
  { code: 'KeyV', us: ['v', 'V'], ru: ['м', 'М'] },
  { code: 'KeyB', us: ['b', 'B'], ru: ['и', 'И'] },
  { code: 'KeyN', us: ['n', 'N'], ru: ['т', 'Т'] },
  { code: 'KeyM', us: ['m', 'M'], ru: ['ь', 'Ь'] },
  { code: 'Comma', us: [',', '<'], ru: ['б', 'Б'] },
  { code: 'Period', us: ['.', '>'], ru: ['ю', 'Ю'] },
  { code: 'Slash', us: ['/', '?'], ru: ['.', ','] },
];

// code → [unshiftedUS, shiftedUS]
const US_BY_CODE: Record<string, [string, string]> = {};
// numpad digits (some scanners emit these) and Space — layout-independent already
for (let d = 0; d <= 9; d++) US_BY_CODE[`Numpad${d}`] = [String(d), String(d)];
US_BY_CODE['NumpadDecimal'] = ['.', '.'];
US_BY_CODE['Space'] = [' ', ' '];

// Inverse map: any char the RU layout can emit → the US-QWERTY char the scanner intended.
// Built from the same table so it stays an exact inverse. Chars produced identically by both
// layouts (digits, `+ - = _ ( ) * % !` …) are simply absent here and left untouched.
const RU_TO_US: Record<string, string> = {};
for (const row of LAYOUT) {
  US_BY_CODE[row.code] = row.us;
  for (const i of [0, 1] as const) {
    if (row.ru[i] !== row.us[i]) RU_TO_US[row.ru[i]] = row.us[i];
  }
}

const CYRILLIC = /[Ѐ-ӿ]/;

/**
 * The ASCII character a US-QWERTY keyboard produces for a given physical key
 * (`KeyboardEvent.code`) and shift state — independent of the OS input language.
 * Returns `null` for non-character keys (Enter, Tab, F-keys, arrows, …) so callers can let
 * those fall through to their own handlers.
 */
export function physicalKeyToChar(code: string, shift: boolean): string | null {
  const entry = US_BY_CODE[code];
  if (!entry) return null;
  return entry[shift ? 1 : 0];
}

/** True if `s` contains any Cyrillic char — i.e. it was captured under a Russian layout. */
export function isLayoutCorrupted(s: string): boolean {
  return CYRILLIC.test(s);
}

/**
 * Reverse a string that was typed by a scanner while a Russian layout was active, mapping each
 * Cyrillic (and layout-shifted symbol) char back to the US-QWERTY char the scanner intended.
 * If the string contains no Cyrillic it is assumed clean and returned unchanged — this avoids
 * touching codes that were captured correctly. A whole scan happens under one layout, so a
 * corrupted code is corrupted end-to-end and the inverse map restores it exactly.
 */
export function repairCyrillicLayout(s: string): string {
  if (!isLayoutCorrupted(s)) return s;
  let out = '';
  for (const ch of s) out += RU_TO_US[ch] ?? ch;
  return out;
}
