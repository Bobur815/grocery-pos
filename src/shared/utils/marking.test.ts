import { isMarkedMxik, MARKING_GROUP_CODES } from './marking';

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
