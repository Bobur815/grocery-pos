import { findBarcodeMatch } from './mxik-lookup';
import { mapPackageNames, pickSingleUnitPackage } from './mxik-packages';

// Real tasnif `elasticsearch/search?search=4780136191983` payload (trimmed): the searched
// barcode is NOT indexed, yet the endpoint returns near-miss digit variants. Taking data[0]
// imported Пиво АЗИЯ's MXIK and package code onto a Bio Life water product.
const FUZZY_ROWS = [
  { mxikCode: '02203001001106003', internationalCode: '4780036191083' },
  { mxikCode: '02202002001023020', internationalCode: '4780036191953' },
  { mxikCode: '02201001001047019', internationalCode: '4780136191990' },
];

describe('findBarcodeMatch', () => {
  it('returns undefined when no row carries the exact barcode', () => {
    expect(findBarcodeMatch(FUZZY_ROWS, '4780136191983')).toBeUndefined();
  });

  it('returns the exactly matching row, not the first one', () => {
    expect(findBarcodeMatch(FUZZY_ROWS, '4780136191990')?.mxikCode).toBe('02201001001047019');
  });

  it('ignores leading-zero padding (GTIN-14 vs EAN-13)', () => {
    expect(findBarcodeMatch(FUZZY_ROWS, '04780036191083')?.mxikCode).toBe('02203001001106003');
  });

  it('handles empty input', () => {
    expect(findBarcodeMatch([], '4780136191983')).toBeUndefined();
    expect(findBarcodeMatch(FUZZY_ROWS, '')).toBeUndefined();
  });
});

describe('pickSingleUnitPackage on real tasnif packageNames', () => {
  it('picks the unit package, not packageNames[0] which is a 6-pack', () => {
    // Real `integration-mxik/get/history/02203001001106003` packageNames.
    const pkgs = mapPackageNames([
      { code: 1744019, nameRu: 'блок=6 шт (ПЭТ бутылка) 2,3 литр' },
      { code: 1011459, nameRu: 'шт (ПЭТ бутылка) 2,3 литр' },
    ]);
    expect(pickSingleUnitPackage(pkgs)?.code).toBe('1011459');
  });

  it('picks the only package when tasnif lists one', () => {
    // Real `integration-mxik/get/history/02201002001028046` (Bio Life Active 1.5 л).
    const pkgs = mapPackageNames([
      { code: 1805053, nameRu: 'шт. (пэт бутылка) 1.5 литр' },
    ]);
    expect(pickSingleUnitPackage(pkgs)?.code).toBe('1805053');
  });
});
