import { isMarkedMxik, MARKING_GROUP_CODES, productRequiresMarking } from './marking';

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
