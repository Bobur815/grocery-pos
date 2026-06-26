import { isMarkedMxik, MARKING_GROUP_CODE } from './marking';

describe('isMarkedMxik', () => {
  it('flags a product whose MXIK is in group 022', () => {
    expect(isMarkedMxik('02201001001424002')).toBe(true);
    expect(isMarkedMxik('02202003001002009')).toBe(true);
    expect(MARKING_GROUP_CODE).toBe('022');
  });

  it('does not flag products in other groups', () => {
    expect(isMarkedMxik('01806001008016007')).toBe(false); // 018 confectionery
    expect(isMarkedMxik('02009001006035029')).toBe(false); // 020 juice
    expect(isMarkedMxik('00000000000000000')).toBe(false);
  });

  it('handles missing / empty MXIK', () => {
    expect(isMarkedMxik(null)).toBe(false);
    expect(isMarkedMxik(undefined)).toBe(false);
    expect(isMarkedMxik('')).toBe(false);
  });
});
