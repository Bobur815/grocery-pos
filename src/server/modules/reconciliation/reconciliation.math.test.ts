import { Prisma, StockMovementType } from '@prisma/client';
import {
  computeBookQty,
  computeVariance,
  crossCheck,
  findAnchor,
  latestCost,
  type LedgerRow,
} from './reconciliation.math';

const D = (n: number | string) => new Prisma.Decimal(n);
const at = (iso: string) => new Date(iso);

function row(
  type: StockMovementType,
  quantity: number,
  occurredAt: string,
  extra: Partial<LedgerRow> = {},
): LedgerRow {
  return {
    type,
    quantity: D(quantity),
    balanceAfter: null,
    appliedToStock: true,
    occurredAt: at(occurredAt),
    unitCost: null,
    unitPrice: null,
    ...extra,
  };
}

const END = at('2026-12-31T00:00:00Z');

describe('computeBookQty — no anchor', () => {
  it('sums signed movements from zero', () => {
    const rows = [
      row('OPENING', 100, '2026-01-01T00:00:00Z'),
      row('ARRIVAL', 50, '2026-01-05T00:00:00Z'),
      row('SALE', -30, '2026-01-06T00:00:00Z'),
      row('SUPPLIER_RETURN', -5, '2026-01-07T00:00:00Z'),
    ];
    expect(computeBookQty(rows, END).bookQty.toNumber()).toBe(115);
  });

  it('ignores movements after the period end', () => {
    const rows = [
      row('OPENING', 100, '2026-01-01T00:00:00Z'),
      row('SALE', -40, '2027-01-01T00:00:00Z'),
    ];
    expect(computeBookQty(rows, END).bookQty.toNumber()).toBe(100);
  });
});

describe('computeBookQty — the stocktake anchor', () => {
  it('starts from balanceAfter and ignores everything at or before it', () => {
    // The pre-count history is deliberately wrong: the anchor is the counted truth and must
    // completely replace it, not be added to it.
    const rows = [
      row('OPENING', 100, '2026-01-01T00:00:00Z'),
      row('SALE', -30, '2026-02-01T00:00:00Z'),
      row('STOCKTAKE_ADJUSTMENT', -12, '2026-03-01T00:00:00Z', { balanceAfter: D(58) }),
      row('SALE', -8, '2026-03-05T00:00:00Z'),
    ];
    const res = computeBookQty(rows, END);
    expect(res.bookQty.toNumber()).toBe(50); // 58 − 8, NOT 100−30−12−8
    expect(res.anchorAt).toEqual(at('2026-03-01T00:00:00Z'));
  });

  it('uses the LATEST anchor when several counts happened', () => {
    const rows = [
      row('STOCKTAKE_ADJUSTMENT', -5, '2026-03-01T00:00:00Z', { balanceAfter: D(58) }),
      row('SALE', -8, '2026-03-05T00:00:00Z'),
      row('STOCKTAKE_ADJUSTMENT', 2, '2026-06-01T00:00:00Z', { balanceAfter: D(40) }),
      row('SALE', -10, '2026-06-10T00:00:00Z'),
    ];
    expect(computeBookQty(rows, END).bookQty.toNumber()).toBe(30);
  });

  it('ignores an anchor that falls after the period end', () => {
    const rows = [
      row('OPENING', 100, '2026-01-01T00:00:00Z'),
      row('STOCKTAKE_ADJUSTMENT', -50, '2027-06-01T00:00:00Z', { balanceAfter: D(50) }),
    ];
    const res = computeBookQty(rows, END);
    expect(res.bookQty.toNumber()).toBe(100);
    expect(res.anchorAt).toBeNull();
  });

  it('excludes rows sharing the anchor timestamp — a count writes them all at one instant', () => {
    const rows = [
      row('OPENING', 100, '2026-01-01T00:00:00Z'),
      row('STOCKTAKE_WRITE_OFF', -100, '2026-03-01T00:00:00Z', { balanceAfter: D(0) }),
    ];
    expect(computeBookQty(rows, END).bookQty.toNumber()).toBe(0);
  });
});

describe('computeBookQty — watermark-suppressed rows', () => {
  it('counts them for audit but never sums them', () => {
    // A sale that predates the last count: it happened, but the server deliberately skipped
    // the decrement because the counted figure already reflects it.
    const rows = [
      row('OPENING', 100, '2026-01-01T00:00:00Z'),
      row('SALE', -20, '2026-02-01T00:00:00Z', { appliedToStock: false }),
      row('SALE', -5, '2026-02-02T00:00:00Z'),
    ];
    const res = computeBookQty(rows, END);
    expect(res.bookQty.toNumber()).toBe(95); // NOT 75
    expect(res.suppressedCount).toBe(1);
  });
});

describe('findAnchor / latestCost', () => {
  it('returns null when nothing is anchored', () => {
    expect(findAnchor([row('SALE', -1, '2026-01-01T00:00:00Z')], END)).toBeNull();
  });

  it('takes the most recent cost snapshot, not Product.cost', () => {
    const rows = [
      row('ARRIVAL', 10, '2026-01-01T00:00:00Z', { unitCost: D(1000) }),
      row('ARRIVAL', 10, '2026-06-01T00:00:00Z', { unitCost: D(1500) }),
      row('SALE', -1, '2026-07-01T00:00:00Z'), // null cost must not clobber the answer
    ];
    expect(latestCost(rows, END)!.toNumber()).toBe(1500);
  });

  it('ignores cost snapshots from after the period', () => {
    const rows = [
      row('ARRIVAL', 10, '2026-01-01T00:00:00Z', { unitCost: D(1000) }),
      row('ARRIVAL', 10, '2027-06-01T00:00:00Z', { unitCost: D(9999) }),
    ];
    expect(latestCost(rows, END)!.toNumber()).toBe(1000);
  });
});

describe('computeVariance', () => {
  const rows = [
    row('OPENING', 100, '2026-01-01T00:00:00Z', { unitCost: D(6000), unitPrice: D(9000) }),
    row('SALE', -40, '2026-02-01T00:00:00Z'),
  ];

  it('reports a shortage as positive and values it at cost and retail', () => {
    const v = computeVariance(1, rows, D(55), END); // book 60, counted 55
    expect(v.varianceQty!.toNumber()).toBe(5);
    expect(v.varianceCost!.toNumber()).toBe(30000);
    expect(v.varianceRetail!.toNumber()).toBe(45000);
  });

  it('reports a surplus as negative', () => {
    expect(computeVariance(1, rows, D(63), END).varianceQty!.toNumber()).toBe(-3);
  });

  it('reconciles to exactly zero when the count matches the book', () => {
    const v = computeVariance(1, rows, D(60), END);
    expect(v.varianceQty!.isZero()).toBe(true);
    expect(v.varianceCost!.isZero()).toBe(true);
  });

  it('leaves variance null for an uncounted product rather than assuming zero', () => {
    const v = computeVariance(1, rows, null, END);
    expect(v.varianceQty).toBeNull();
    expect(v.varianceCost).toBeNull();
    expect(v.bookQty.toNumber()).toBe(60);
  });
});

describe('crossCheck', () => {
  it('is silent when perpetual and recomputed agree', () => {
    expect(
      crossCheck(new Map([[1, D(10)]]), new Map([[1, D(10)]])),
    ).toEqual([]);
  });

  it('reports drift — an app bug, never shrinkage', () => {
    // e.g. a box sale deleted through a path that restored 1 instead of 5.
    const out = crossCheck(new Map([[1, D(14)]]), new Map([[1, D(10)]]));
    expect(out).toHaveLength(1);
    expect(out[0].drift.toNumber()).toBe(4);
  });

  it('treats a product with no ledger rows as zero rather than skipping it', () => {
    const out = crossCheck(new Map([[7, D(3)]]), new Map());
    expect(out[0].drift.toNumber()).toBe(3);
  });
});

// The composition the service actually performs. These are the tests that were missing when
// goods() measured the book at periodEnd: every case below passed in isolation while the
// assembled report was meaningless.
describe('measuring a stocktake (exclusiveEnd)', () => {
  const COUNT_AT = at('2026-03-01T09:00:00Z');

  /** What the ledger looks like after: seed 100, sell 40, then count and find 55. */
  const rowsWithCount = (countedTo: number): LedgerRow[] => [
    row('OPENING', 100, '2026-01-01T00:00:00Z', { balanceAfter: D(100), unitCost: D(6000) }),
    row('SALE', -40, '2026-02-01T00:00:00Z'),
    // The count's own movement, written at completion with its resulting level.
    row('STOCKTAKE_ADJUSTMENT', countedTo - 60, '2026-03-01T09:00:00Z', {
      balanceAfter: D(countedTo),
    }),
  ];

  it('reconstructs the book as it stood just before the count', () => {
    const res = computeBookQty(rowsWithCount(55), COUNT_AT, true);
    expect(res.bookQty.toNumber()).toBe(60); // 100 − 40, NOT the counted 55
    expect(res.anchorAt).toEqual(at('2026-01-01T00:00:00Z')); // the OPENING, not the count
  });

  it('finds the real shortage instead of collapsing to zero', () => {
    const v = computeVariance(1, rowsWithCount(55), D(55), COUNT_AT, true);
    expect(v.varianceQty!.toNumber()).toBe(5); // 60 book − 55 counted
    expect(v.varianceCost!.toNumber()).toBe(30000);
  });

  it('an inclusive bound would have hidden it — this is the regression', () => {
    // Anchors on the count being judged, so book == counted and variance == 0 forever.
    const wrong = computeVariance(1, rowsWithCount(55), D(55), COUNT_AT, false);
    expect(wrong.varianceQty!.toNumber()).toBe(0);
  });

  it('sales made after the count do not leak into its variance', () => {
    const rows = [
      ...rowsWithCount(55),
      row('SALE', -7, '2026-03-01T15:00:00Z'), // same day, after counting
    ];
    const v = computeVariance(1, rows, D(55), COUNT_AT, true);
    expect(v.varianceQty!.toNumber()).toBe(5); // still 5, not 12
  });

  it('measures from the PREVIOUS count when there is one', () => {
    const rows = [
      row('OPENING', 100, '2026-01-01T00:00:00Z', { balanceAfter: D(100) }),
      row('STOCKTAKE_ADJUSTMENT', -10, '2026-02-01T09:00:00Z', { balanceAfter: D(90) }),
      row('SALE', -20, '2026-02-15T00:00:00Z'),
      row('STOCKTAKE_ADJUSTMENT', -4, '2026-03-01T09:00:00Z', { balanceAfter: D(66) }),
    ];
    const res = computeBookQty(rows, COUNT_AT, true);
    expect(res.bookQty.toNumber()).toBe(70); // 90 − 20
    expect(res.anchorAt).toEqual(at('2026-02-01T09:00:00Z'));
    // 70 book vs 66 counted → 4 missing between the two counts.
    expect(computeVariance(1, rows, D(66), COUNT_AT, true).varianceQty!.toNumber()).toBe(4);
  });
});
