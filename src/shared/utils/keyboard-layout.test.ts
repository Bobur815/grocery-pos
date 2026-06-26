import {
  physicalKeyToChar,
  isLayoutCorrupted,
  repairCyrillicLayout,
} from './keyboard-layout';

describe('physicalKeyToChar', () => {
  it('maps physical keys to US-QWERTY chars regardless of OS layout', () => {
    expect(physicalKeyToChar('KeyQ', false)).toBe('q');
    expect(physicalKeyToChar('KeyQ', true)).toBe('Q');
    expect(physicalKeyToChar('Digit1', false)).toBe('1');
    expect(physicalKeyToChar('Slash', false)).toBe('/');
    expect(physicalKeyToChar('Slash', true)).toBe('?');
    expect(physicalKeyToChar('Equal', true)).toBe('+');
    expect(physicalKeyToChar('Numpad5', false)).toBe('5');
  });

  it('returns null for non-character keys so callers can fall through', () => {
    expect(physicalKeyToChar('Enter', false)).toBeNull();
    expect(physicalKeyToChar('Backspace', false)).toBeNull();
    expect(physicalKeyToChar('F10', false)).toBeNull();
    expect(physicalKeyToChar('ArrowLeft', false)).toBeNull();
  });
});

describe('repairCyrillicLayout', () => {
  it('leaves clean ASCII codes untouched', () => {
    const clean = '010460741017114421RO+jTyXP';
    expect(isLayoutCorrupted(clean)).toBe(false);
    expect(repairCyrillicLayout(clean)).toBe(clean);
  });

  it('restores a marking serial typed under a Russian layout', () => {
    // "'RO+jTyXP" as the scanner would render it under a Russian keyboard layout.
    const corrupted = 'эКЩ+оЕнЧЗ';
    expect(isLayoutCorrupted(corrupted)).toBe(true);
    expect(repairCyrillicLayout(corrupted)).toBe("'RO+jTyXP");
  });

  it('keeps the digit-only GTIN prefix intact while fixing the alphanumeric tail', () => {
    // Digits survive any layout, so only the letters of the serial are corrupted.
    const corrupted = '0104607410171144' + '21' + 'эКЩ+оЕнЧЗ';
    expect(repairCyrillicLayout(corrupted)).toBe(
      '0104607410171144' + '21' + "'RO+jTyXP",
    );
  });

  it('maps individual Cyrillic letters back to their US-QWERTY origin', () => {
    expect(repairCyrillicLayout('Й')).toBe('Q');
    expect(repairCyrillicLayout('й')).toBe('q');
  });

  it('remaps layout-shifted symbols (e.g. RU "." → "/") only inside a corrupted string', () => {
    // "." standalone is plain ASCII (not corrupted) → left as-is.
    expect(repairCyrillicLayout('.')).toBe('.');
    // But once the string is corrupted (contains Cyrillic), every char is inverse-mapped, so a
    // "." that the RU layout produced for the scanner's "/" key is restored to "/".
    expect(repairCyrillicLayout('Й.')).toBe('Q/');
  });
});
