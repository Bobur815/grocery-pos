// Multi-piece packaging (a "box") — selling one catalog product either as a single piece or as a
// sealed pack of N pieces.
//
// The invariant of the whole feature: STOCK IS ALWAYS COUNTED IN PIECES. A cart line / SaleItem
// carries `quantity` in SALE UNITS (boxes or pieces) together with the price of that unit, plus
// `piecesPerUnit` — the multiplier back to pieces. Anything that touches stock or reports a
// physical count to the fiscal system converts through toPieces() first.
//
// Storing pieces directly and dividing the box price was rejected: boxPrice / piecesPerBox does
// not divide evenly in tiyin, so line subtotals would drift away from what the customer paid.

/** piecesPerUnit for an ordinary single-piece line. */
export const PIECE = 1;

/**
 * True when a product may be sold as a box, i.e. it has a pack of more than one piece.
 * A null/0/1 piecesPerBox means "no pack" — the product behaves exactly as it always has.
 */
export function isBoxedProduct(product: { piecesPerBox?: number | null }): boolean {
  return typeof product.piecesPerBox === 'number' && product.piecesPerBox > 1;
}

/**
 * Convert a quantity expressed in sale units into pieces.
 * Missing/invalid multipliers fall back to 1, so every pre-existing row stays correct.
 */
export function toPieces(quantity: number, piecesPerUnit?: number | null): number {
  const n = Number(piecesPerUnit);
  return quantity * (Number.isFinite(n) && n > 0 ? n : PIECE);
}

/**
 * Price of one box. Falls back to piecePrice x piecesPerBox when boxPrice was never set, so a
 * half-configured product still rings up at a sane (undiscounted) price instead of 0.
 */
export function boxUnitPrice(product: {
  price: number;
  boxPrice?: number | null;
  piecesPerBox?: number | null;
}): number {
  const explicit = Number(product.boxPrice);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Number(product.price) * (product.piecesPerBox || PIECE);
}
