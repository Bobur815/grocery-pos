import { Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

/** The subset of a shift the drawer arithmetic reads. Keeps this file DB-free and testable. */
export interface DrawerShift {
  initialCash: Prisma.Decimal;
  finalCash: Prisma.Decimal | null;
  cashSalesAmount: Prisma.Decimal;
  payInTotal: Prisma.Decimal;
  payOutTotal: Prisma.Decimal;
  returnAmount: Prisma.Decimal;
}

export interface DrawerResult {
  /** What the till should have held at close, given everything known to have moved through it. */
  expectedCash: Prisma.Decimal;
  /** What the cashier actually counted. Null on a shift that never closed. */
  actualCash: Prisma.Decimal | null;
  /** actual − expected. NEGATIVE = shortage (nedostacha), positive = surplus. Null if unclosed. */
  variance: Prisma.Decimal | null;
}

/**
 * Expected drawer cash for one shift.
 *
 *   opening float + cash sales + pay-ins − pay-outs − cash refunds
 *
 * Card and UzQR are absent by construction: they settle to the bank and never enter the till,
 * so including them would manufacture a shortage the size of every cashless sale. `cashSales`
 * is filtered through `isCashTender()` on the terminal before it is ever sent.
 */
export function computeDrawer(shift: DrawerShift): DrawerResult {
  const expectedCash = shift.initialCash
    .plus(shift.cashSalesAmount)
    .plus(shift.payInTotal)
    .minus(shift.payOutTotal)
    .minus(shift.returnAmount);

  // An open shift has no counted figure yet. Reported as null rather than 0 so the UI can say
  // "not counted" instead of implying the drawer was found empty.
  if (shift.finalCash === null) {
    return { expectedCash, actualCash: null, variance: null };
  }

  return {
    expectedCash,
    actualCash: shift.finalCash,
    variance: shift.finalCash.minus(expectedCash),
  };
}

export interface DrawerTotals extends DrawerResult {
  /** Shifts that contributed. Zero means the period has no shift data at all. */
  shiftCount: number;
}

/**
 * Sum the drawer position across a period's shifts.
 *
 * Shifts with no `finalCash` are skipped entirely rather than counted as zero — a single open
 * shift in the range must not drag the period's variance down by its whole expected takings.
 */
export function sumDrawers(shifts: readonly DrawerShift[]): DrawerTotals {
  let expectedCash = ZERO;
  let actualCash = ZERO;
  let shiftCount = 0;

  for (const s of shifts) {
    const d = computeDrawer(s);
    if (d.actualCash === null) continue;
    expectedCash = expectedCash.plus(d.expectedCash);
    actualCash = actualCash.plus(d.actualCash);
    shiftCount++;
  }

  if (shiftCount === 0) {
    return { expectedCash: ZERO, actualCash: null, variance: null, shiftCount: 0 };
  }

  return {
    expectedCash,
    actualCash,
    variance: actualCash.minus(expectedCash),
    shiftCount,
  };
}
