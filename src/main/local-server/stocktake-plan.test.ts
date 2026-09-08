// The planner reaches the Decimal class through sqlite-client, which loads the generated client
// from an Electron runtime path. Neither exists under Jest, so the namespace is served straight
// from the generated client instead — the same Decimal, without booting Electron.
jest.mock('../database/sqlite-client', () => ({
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getPrismaNamespace: () => require('../../generated/prisma-sqlite').Prisma,
}));

import { planCompletion, type PlannableItem } from './stocktake-plan';

/** A line nobody has counted yet. */
const uncounted = (id: string, expectedQty: number, cost: number | null = 10): PlannableItem => ({
  id,
  productId: Number(id.replace(/\D/g, '')) || 1,
  expectedQty,
  cost,
  countedQty: null,
  counted: false,
});

const counted = (
  id: string,
  expectedQty: number,
  countedQty: number,
  cost: number | null = 10,
): PlannableItem => ({ ...uncounted(id, expectedQty, cost), countedQty, counted: true });

describe('planCompletion', () => {
  it('records the difference between counted and expected', () => {
    const plan = planCompletion([counted('1', 10, 7)], false);
    expect(plan.rows).toEqual([
      { itemId: '1', productId: 1, countedQty: '7', difference: '-3', writtenOff: false },
    ]);
    expect(plan.countedItems).toBe(1);
    expect(plan.totalDifference.toString()).toBe('-3');
  });

  it('values the difference at the line cost', () => {
    const plan = planCompletion([counted('1', 10, 7, 250)], false);
    expect(plan.totalValueDiff.toString()).toBe('-750');
  });

  it('leaves value alone for a line with no cost price', () => {
    const plan = planCompletion([counted('1', 10, 7, null)], false);
    expect(plan.totalDifference.toString()).toBe('-3');
    expect(plan.totalValueDiff.toString()).toBe('0');
  });

  it('ignores uncounted lines when nothing is written off', () => {
    const plan = planCompletion([counted('1', 5, 5), uncounted('2', 8)], false);
    expect(plan.rows).toHaveLength(1);
    expect(plan.writtenOffItems).toBe(0);
  });

  it('zeroes every eligible uncounted line when told to', () => {
    const plan = planCompletion([counted('1', 5, 5), uncounted('2', 8)], true);
    expect(plan.writtenOffItems).toBe(1);
    const written = plan.rows.find((r) => r.writtenOff);
    expect(written).toMatchObject({ itemId: '2', countedQty: '0', difference: '-8' });
    expect(plan.writeOffValue.toString()).toBe('-80');
  });

  // A line already expected at zero has nothing to write off; counting it would inflate the tally.
  it('does not write off a line expected at zero', () => {
    const plan = planCompletion([counted('1', 5, 5), uncounted('2', 0)], true);
    expect(plan.writtenOffItems).toBe(0);
  });

  it('never writes off a line that was counted, even at zero', () => {
    const plan = planCompletion([counted('1', 5, 0)], true);
    expect(plan.writtenOffItems).toBe(0);
    expect(plan.rows[0].writtenOff).toBe(false);
  });

  it('writes off only the named lines when given a set', () => {
    const plan = planCompletion(
      [counted('1', 5, 5), uncounted('2', 8), uncounted('3', 4)],
      new Set(['2']),
    );
    expect(plan.writtenOffItems).toBe(1);
    expect(plan.rows.find((r) => r.writtenOff)?.itemId).toBe('2');
  });

  // A stale page must not be able to zero a line somebody has since counted, or one from another
  // document — the selection is intersected with what is actually eligible, never trusted.
  it('ignores ids that are not eligible uncounted lines', () => {
    const plan = planCompletion(
      [counted('1', 5, 5), uncounted('2', 8)],
      new Set(['1', '2', 'from-another-document']),
    );
    expect(plan.writtenOffItems).toBe(1);
    expect(plan.rows.find((r) => r.writtenOff)?.itemId).toBe('2');
  });

  it('writes nothing off for an empty selection', () => {
    const plan = planCompletion([counted('1', 5, 5), uncounted('2', 8)], new Set<string>());
    expect(plan.writtenOffItems).toBe(0);
  });

  it('separates write-off value from the total, which includes both', () => {
    const plan = planCompletion([counted('1', 10, 8, 100), uncounted('2', 5, 100)], true);
    // Counted short by 2 (−200) plus a 5-unit write-off (−500).
    expect(plan.totalValueDiff.toString()).toBe('-700');
    expect(plan.writeOffValue.toString()).toBe('-500');
  });

  it('reports a surplus as a positive difference', () => {
    const plan = planCompletion([counted('1', 3, 5, 20)], false);
    expect(plan.totalDifference.toString()).toBe('2');
    expect(plan.totalValueDiff.toString()).toBe('40');
  });

  // Decimal, not floats: 0.1 + 0.2 arithmetic on quantities would leave rounding dust in a
  // figure that gets written straight back to product stock.
  it('keeps fractional quantities exact', () => {
    const plan = planCompletion([counted('1', 0.3, 0.1, 3)], false);
    expect(plan.totalDifference.toString()).toBe('-0.2');
    expect(plan.totalValueDiff.toString()).toBe('-0.6');
  });

  it('counts nothing for an empty document', () => {
    const plan = planCompletion([], true);
    expect(plan.rows).toEqual([]);
    expect(plan.countedItems).toBe(0);
    expect(plan.totalDifference.toString()).toBe('0');
  });
});
