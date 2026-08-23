import { Prisma, StockMovementType } from '@prisma/client';

/** The subset of a ledger row the arithmetic actually reads. Keeps this file DB-free and testable. */
export interface LedgerRow {
  type: StockMovementType;
  /** Signed. */
  quantity: Prisma.Decimal;
  /** Non-null only on stocktake rows — the absolute level stock was set to. */
  balanceAfter: Prisma.Decimal | null;
  appliedToStock: boolean;
  occurredAt: Date;
  unitCost: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal | null;
}

export interface BookResult {
  bookQty: Prisma.Decimal;
  /** When the anchor was set, or null if the whole history was summed. */
  anchorAt: Date | null;
  /** Rows that happened but were never applied to stock — shown, never summed. */
  suppressedCount: number;
}

const ZERO = new Prisma.Decimal(0);

/**
 * The most recent absolute anchor at or before `asOf`.
 *
 * Completing a stocktake is the only absolute stock write in the system; every other path is a
 * delta. Anchoring on it is not an optimisation — it is required for correctness. The
 * `stock_counted_at` watermark makes the server skip decrements for sales that predate a count
 * (they are already baked into the counted figure), so summing a product's whole history would
 * subtract those sales a second time and report a permanent phantom shortage on every store
 * that has ever counted.
 */
export function findAnchor(rows: readonly LedgerRow[], asOf: Date): LedgerRow | null {
  let anchor: LedgerRow | null = null;
  for (const r of rows) {
    if (r.balanceAfter === null) continue;
    if (r.occurredAt > asOf) continue;
    if (!anchor || r.occurredAt >= anchor.occurredAt) anchor = r;
  }
  return anchor;
}

/**
 * Book quantity for one product at `asOf`: the last counted truth, plus everything that moved
 * since.
 *
 * Rows sharing the anchor's exact timestamp are excluded along with it (`>`, not `>=`). A
 * stocktake writes all of its rows with one timestamp, and its `balanceAfter` already states
 * the resulting level — re-adding anything stamped at that instant would double-count the
 * count itself.
 */
export function computeBookQty(rows: readonly LedgerRow[], asOf: Date): BookResult {
  const anchor = findAnchor(rows, asOf);
  let qty = anchor ? anchor.balanceAfter! : ZERO;
  let suppressedCount = 0;

  for (const r of rows) {
    if (r.occurredAt > asOf) continue;
    if (anchor && r.occurredAt <= anchor.occurredAt) continue;
    if (!r.appliedToStock) {
      suppressedCount++;
      continue;
    }
    qty = qty.plus(r.quantity);
  }

  return { bookQty: qty, anchorAt: anchor?.occurredAt ?? null, suppressedCount };
}

/**
 * Latest known unit cost at or before `asOf`, for valuing a variance.
 *
 * Read off the movements rather than `Product.cost` on purpose: `Product.cost` is a single
 * mutable field that every arrival overwrites, so by the time anyone runs a monthly
 * reconciliation it no longer reflects what the missing goods actually cost.
 */
export function latestCost(rows: readonly LedgerRow[], asOf: Date): Prisma.Decimal | null {
  let best: LedgerRow | null = null;
  for (const r of rows) {
    if (r.unitCost === null || r.occurredAt > asOf) continue;
    if (!best || r.occurredAt >= best.occurredAt) best = r;
  }
  return best?.unitCost ?? null;
}

export function latestPrice(rows: readonly LedgerRow[], asOf: Date): Prisma.Decimal | null {
  let best: LedgerRow | null = null;
  for (const r of rows) {
    if (r.unitPrice === null || r.occurredAt > asOf) continue;
    if (!best || r.occurredAt >= best.occurredAt) best = r;
  }
  return best?.unitPrice ?? null;
}

export interface ProductVariance {
  productId: number;
  bookQty: Prisma.Decimal;
  countedQty: Prisma.Decimal | null;
  /** book − counted. Positive = shortage (kamomad), negative = surplus. Null when uncounted. */
  varianceQty: Prisma.Decimal | null;
  varianceCost: Prisma.Decimal | null;
  varianceRetail: Prisma.Decimal | null;
  anchorAt: Date | null;
  suppressedCount: number;
}

/**
 * Goods variance for one product. Quantities first, money second — quantity is immune to a
 * mid-period price change, which is the whole reason this reconciles per SKU rather than on
 * aggregate retail value.
 */
export function computeVariance(
  productId: number,
  rows: readonly LedgerRow[],
  countedQty: Prisma.Decimal | null,
  asOf: Date,
): ProductVariance {
  const { bookQty, anchorAt, suppressedCount } = computeBookQty(rows, asOf);
  const varianceQty = countedQty === null ? null : bookQty.minus(countedQty);
  const cost = latestCost(rows, asOf);
  const price = latestPrice(rows, asOf);

  return {
    productId,
    bookQty,
    countedQty,
    varianceQty,
    varianceCost: varianceQty && cost ? varianceQty.times(cost) : null,
    varianceRetail: varianceQty && price ? varianceQty.times(price) : null,
    anchorAt,
    suppressedCount,
  };
}

export interface CrossCheckRow {
  productId: number;
  perpetual: Prisma.Decimal;
  recomputed: Prisma.Decimal;
  drift: Prisma.Decimal;
}

/**
 * Perpetual (`Product.stock`) vs recomputed (the ledger). They must agree.
 *
 * A mismatch is an application, data or sync BUG — a decrement that never fired, a non-atomic
 * restore, an emission that failed — and emphatically NOT theft. It is reported separately and
 * worded differently so nobody spends a week hunting a thief for what is a missing UPDATE.
 */
export function crossCheck(
  perpetualByProduct: ReadonlyMap<number, Prisma.Decimal>,
  recomputedByProduct: ReadonlyMap<number, Prisma.Decimal>,
): CrossCheckRow[] {
  const out: CrossCheckRow[] = [];
  for (const [productId, perpetual] of perpetualByProduct) {
    const recomputed = recomputedByProduct.get(productId) ?? ZERO;
    const drift = perpetual.minus(recomputed);
    if (!drift.isZero()) out.push({ productId, perpetual, recomputed, drift });
  }
  return out;
}
