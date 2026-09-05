import { Prisma } from '@prisma/client';
import { computeDrawer, sumDrawers, type DrawerShift } from './smena.math';

const D = (n: string | number) => new Prisma.Decimal(n);

function shift(over: Partial<DrawerShift> = {}): DrawerShift {
  return {
    initialCash: D(0),
    finalCash: D(0),
    cashSalesAmount: D(0),
    payInTotal: D(0),
    payOutTotal: D(0),
    returnAmount: D(0),
    ...over,
  };
}

describe('computeDrawer', () => {
  it('adds the opening float to cash sales', () => {
    const r = computeDrawer(
      shift({ initialCash: D(200_000), cashSalesAmount: D(650_000), finalCash: D(850_000) }),
    );
    expect(r.expectedCash.toString()).toBe('850000');
    expect(r.variance!.toString()).toBe('0');
  });

  it('ignores cashless takings — they never reach the till', () => {
    // A shift that sold 300k on card and nothing in cash must still expect only its float.
    // cardSalesAmount is not even an input here; this pins that it can never leak in.
    const r = computeDrawer(shift({ initialCash: D(200_000), finalCash: D(200_000) }));
    expect(r.expectedCash.toString()).toBe('200000');
    expect(r.variance!.toString()).toBe('0');
  });

  it('reports a shortage as a negative variance', () => {
    const r = computeDrawer(
      shift({ initialCash: D(100_000), cashSalesAmount: D(500_000), finalCash: D(570_000) }),
    );
    expect(r.expectedCash.toString()).toBe('600000');
    expect(r.variance!.toString()).toBe('-30000');
  });

  it('reports a surplus as a positive variance', () => {
    const r = computeDrawer(
      shift({ initialCash: D(100_000), cashSalesAmount: D(500_000), finalCash: D(615_000) }),
    );
    expect(r.variance!.toString()).toBe('15000');
  });

  it('subtracts pay-outs and adds pay-ins', () => {
    const r = computeDrawer(
      shift({
        initialCash: D(100_000),
        cashSalesAmount: D(500_000),
        payInTotal: D(50_000),
        payOutTotal: D(200_000),
        finalCash: D(450_000),
      }),
    );
    expect(r.expectedCash.toString()).toBe('450000');
    expect(r.variance!.toString()).toBe('0');
  });

  it('subtracts refunds paid out of the drawer', () => {
    // The refunded sale is gone from `sales`, so cashSalesAmount already excludes it; the cash
    // handed back is the separate term. Missing this reads as a shortage the size of the refund.
    const r = computeDrawer(
      shift({ initialCash: D(100_000), cashSalesAmount: D(500_000), returnAmount: D(40_000), finalCash: D(560_000) }),
    );
    expect(r.expectedCash.toString()).toBe('560000');
    expect(r.variance!.toString()).toBe('0');
  });

  it('returns a null variance for a shift that never closed', () => {
    const r = computeDrawer(shift({ initialCash: D(100_000), finalCash: null }));
    expect(r.actualCash).toBeNull();
    expect(r.variance).toBeNull();
    expect(r.expectedCash.toString()).toBe('100000');
  });
});

describe('sumDrawers', () => {
  it('reports no data rather than a zero variance for an empty period', () => {
    const r = sumDrawers([]);
    expect(r.shiftCount).toBe(0);
    expect(r.actualCash).toBeNull();
    expect(r.variance).toBeNull();
  });

  it('nets a shortage against a surplus across shifts', () => {
    const r = sumDrawers([
      shift({ initialCash: D(100_000), cashSalesAmount: D(500_000), finalCash: D(570_000) }), // −30k
      shift({ initialCash: D(100_000), cashSalesAmount: D(500_000), finalCash: D(610_000) }), // +10k
    ]);
    expect(r.shiftCount).toBe(2);
    expect(r.variance!.toString()).toBe('-20000');
  });

  it('skips an open shift instead of counting its takings as missing', () => {
    // The whole point: one still-open shift in the range must not drag the period's variance
    // down by its entire expected drawer.
    const r = sumDrawers([
      shift({ initialCash: D(100_000), cashSalesAmount: D(500_000), finalCash: D(600_000) }),
      shift({ initialCash: D(100_000), cashSalesAmount: D(900_000), finalCash: null }),
    ]);
    expect(r.shiftCount).toBe(1);
    expect(r.variance!.toString()).toBe('0');
    expect(r.expectedCash.toString()).toBe('600000');
  });
});
