import { PIECE, boxUnitPrice, isBoxedProduct, toPieces } from './pack';

describe('isBoxedProduct', () => {
  it('is false for every product that predates the feature', () => {
    expect(isBoxedProduct({})).toBe(false);
    expect(isBoxedProduct({ piecesPerBox: null })).toBe(false);
  });

  it('treats a pack of one as not a pack', () => {
    // The web form normalises 1 to null, but a hand-edited row must not start prompting.
    expect(isBoxedProduct({ piecesPerBox: 1 })).toBe(false);
    expect(isBoxedProduct({ piecesPerBox: 0 })).toBe(false);
  });

  it('is true from two pieces up', () => {
    expect(isBoxedProduct({ piecesPerBox: 2 })).toBe(true);
    expect(isBoxedProduct({ piecesPerBox: 10 })).toBe(true);
  });
});

describe('toPieces', () => {
  it('leaves ordinary lines untouched', () => {
    expect(toPieces(3)).toBe(3);
    expect(toPieces(3, 1)).toBe(3);
    expect(toPieces(1.5, undefined)).toBe(1.5);
  });

  it('multiplies box lines out to pieces', () => {
    expect(toPieces(1, 5)).toBe(5);
    expect(toPieces(2, 5)).toBe(10);
  });

  it('falls back to 1 for values that would corrupt stock', () => {
    // A historical SaleItem, a null column, or a bad payload must never zero out or
    // reverse a stock decrement.
    expect(toPieces(4, null)).toBe(4);
    expect(toPieces(4, 0)).toBe(4);
    expect(toPieces(4, -2)).toBe(4);
    expect(toPieces(4, NaN)).toBe(4);
  });
});

describe('boxUnitPrice', () => {
  it('uses the explicit box price, including a bulk discount', () => {
    expect(boxUnitPrice({ price: 9000, boxPrice: 40000, piecesPerBox: 5 })).toBe(40000);
  });

  it('falls back to piece price x pack size when boxPrice was never set', () => {
    expect(boxUnitPrice({ price: 9000, boxPrice: null, piecesPerBox: 5 })).toBe(45000);
    expect(boxUnitPrice({ price: 9000, piecesPerBox: 5 })).toBe(45000);
  });

  it('never returns 0 for a half-configured product', () => {
    expect(boxUnitPrice({ price: 9000, boxPrice: 0, piecesPerBox: 5 })).toBe(45000);
  });

  it('degrades to the piece price when there is no pack size', () => {
    expect(boxUnitPrice({ price: 9000 })).toBe(9000);
  });
});

describe('PIECE', () => {
  it('is the identity multiplier', () => {
    expect(toPieces(7, PIECE)).toBe(7);
  });
});
