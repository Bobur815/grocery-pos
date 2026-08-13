import {
  isMarkedMxik,
  MARKING_GROUP_CODES,
  productRequiresMarking,
  normalizeDataMatrix,
  stripCryptoTail,
  toSoldCodeKey,
  extractGtinFromDataMatrix,
} from './marking';

// Real scan captured from REGOS's own marking-check page (Bio Life 0.5 л).
// Note the literal '(' inside the serial — parsing GS1 by splitting on parens corrupts it.
const RAW = '0104780136191969217r0BRg(iUl0zg9301+o';
const LOOKUP = '0104780136191969217r0BRg(iUl0zg';

describe('isMarkedMxik', () => {
  it('flags products whose MXIK is in a marking group (020 / 022)', () => {
    expect(isMarkedMxik('02201001001424002')).toBe(true); // 022
    expect(isMarkedMxik('02202003001002009')).toBe(true); // 022
    expect(isMarkedMxik('02009001006035029')).toBe(true); // 020
    expect(MARKING_GROUP_CODES).toEqual(['020', '022']);
  });

  it('does not flag products in other groups', () => {
    expect(isMarkedMxik('01806001008016007')).toBe(false); // 018 confectionery
    expect(isMarkedMxik('02106999018001042')).toBe(false); // 021 (adjacent, not marking)
    expect(isMarkedMxik('00000000000000000')).toBe(false);
  });

  it('handles missing / empty MXIK', () => {
    expect(isMarkedMxik(null)).toBe(false);
    expect(isMarkedMxik(undefined)).toBe(false);
    expect(isMarkedMxik('')).toBe(false);
  });
});

describe('productRequiresMarking', () => {
  it('uses the authoritative isMarked flag, overriding the group heuristic', () => {
    // False positive the heuristic gets wrong: group 022 but tasnif says plain → NOT marked.
    expect(productRequiresMarking({ isMarked: false, mxik: '02008001001001005' })).toBe(false);
    // False negative the heuristic gets wrong: group 073 but tasnif says marked → marked.
    expect(productRequiresMarking({ isMarked: true, mxik: '07321001003006001' })).toBe(true);
  });

  it('falls back to the group heuristic when isMarked is null/undefined', () => {
    expect(productRequiresMarking({ isMarked: null, mxik: '02201001001424002' })).toBe(true); // 022
    expect(productRequiresMarking({ isMarked: undefined, mxik: '01806001008016007' })).toBe(false); // 018
    expect(productRequiresMarking({ mxik: '02009001006035029' })).toBe(true); // 020, no isMarked key
  });

  it('is false when neither flag nor a marking-group MXIK is present', () => {
    expect(productRequiresMarking({ isMarked: null, mxik: null })).toBe(false);
    expect(productRequiresMarking({})).toBe(false);
  });
});

describe('normalizeDataMatrix', () => {
  it('strips scanner symbology prefixes and a leading FNC1', () => {
    expect(normalizeDataMatrix(']d2' + RAW)).toBe(RAW);
    expect(normalizeDataMatrix(']C1' + RAW)).toBe(RAW);
    expect(normalizeDataMatrix('\x1d' + RAW)).toBe(RAW);
  });

  it('preserves internal GS separators (asl-belgisi needs them)', () => {
    const withGs = '0104780136191969217r0BRg(iUl0zg\x1d9301+o';
    expect(normalizeDataMatrix(']d2' + withGs)).toBe(withGs);
  });
});

describe('stripCryptoTail', () => {
  it('cuts at the first GS byte when the scan has one', () => {
    expect(stripCryptoTail('0104780136191969217r0BRg(iUl0zg\x1d9301+o')).toBe(LOOKUP);
  });

  it('drops a trailing 93 group when there is no GS byte', () => {
    expect(stripCryptoTail(RAW)).toBe(LOOKUP);
  });

  it('keeps a serial containing "(" intact', () => {
    expect(stripCryptoTail(RAW)).toContain('7r0BRg(iUl0zg');
  });

  it('leaves a code without a crypto group untouched', () => {
    expect(stripCryptoTail(LOOKUP)).toBe(LOOKUP);
  });
});

describe('toSoldCodeKey', () => {
  it('KEEPS the crypto tail — this is the sale-path storage form, not the lookup key', () => {
    expect(toSoldCodeKey(RAW)).toBe(RAW);
    expect(toSoldCodeKey(RAW)).not.toBe(stripCryptoTail(RAW));
  });

  it('removes every internal GS byte so it matches what the cart stored', () => {
    expect(toSoldCodeKey(']d2' + '0104780136191969217r0BRg(iUl0zg\x1d9301+o')).toBe(RAW);
  });
});

describe('extractGtinFromDataMatrix', () => {
  it('returns the EAN-13 with the GTIN-14 pad zero dropped', () => {
    expect(extractGtinFromDataMatrix(RAW)).toBe('4780136191969');
    expect(extractGtinFromDataMatrix(']d2' + RAW)).toBe('4780136191969');
  });

  it('returns null when there is no AI 01 header', () => {
    expect(extractGtinFromDataMatrix('4780136191969')).toBeNull();
    expect(extractGtinFromDataMatrix('')).toBeNull();
  });
});
