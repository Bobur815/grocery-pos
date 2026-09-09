/**
 * The pie's slice budget.
 *
 * Six hues, assigned by position and never cycled — so the number of slices is not a styling
 * preference, it is what keeps the palette valid. This is the function that enforces it, and it
 * also has to keep the total honest: a fold that lost revenue would misstate the whole chart.
 */

import { foldCategorySlices, PIE_SLICE_LIMIT } from './categoryPie';

const OTHER = 'Прочие';

function slices(...revenues: number[]) {
  return revenues.map((revenue, i) => ({ name: `Категория ${i + 1}`, revenue }));
}

const total = (rows: { revenue: number }[]) => rows.reduce((s, r) => s + r.revenue, 0);

describe('foldCategorySlices', () => {
  it('sorts by revenue, largest first', () => {
    const out = foldCategorySlices(slices(10, 50, 30), OTHER);

    expect(out.map((c) => c.revenue)).toEqual([50, 30, 10]);
  });

  it('leaves a list at the limit untouched apart from the order', () => {
    const out = foldCategorySlices(slices(1, 2, 3, 4, 5, 6), OTHER);

    expect(out).toHaveLength(PIE_SLICE_LIMIT);
    expect(out.some((c) => c.name === OTHER)).toBe(false);
  });

  it('folds the tail once the list exceeds the limit', () => {
    const out = foldCategorySlices(slices(100, 90, 80, 70, 60, 50, 40), OTHER);

    expect(out).toHaveLength(PIE_SLICE_LIMIT);
    expect(out[PIE_SLICE_LIMIT - 1]).toEqual({ name: OTHER, revenue: 90 });
  });

  it('keeps the biggest categories and pools only the small ones', () => {
    const out = foldCategorySlices(slices(100, 90, 80, 70, 60, 5, 4, 3), OTHER);

    expect(out.slice(0, 5).map((c) => c.revenue)).toEqual([100, 90, 80, 70, 60]);
    expect(out[5]).toEqual({ name: OTHER, revenue: 12 });
  });

  it('never loses revenue — the pie still totals the real figure', () => {
    const input = slices(100, 90, 80, 70, 60, 50, 40, 30, 20, 10);

    expect(total(foldCategorySlices(input, OTHER))).toBe(total(input));
  });

  it('handles an empty period without inventing an Other slice', () => {
    expect(foldCategorySlices([], OTHER)).toEqual([]);
  });

  it('does not mutate the caller\'s array', () => {
    const input = slices(10, 50);
    foldCategorySlices(input, OTHER);

    expect(input.map((c) => c.revenue)).toEqual([10, 50]);
  });

  /** Never cycled: with the tail folded, a slice index can never exceed the palette. */
  it('never returns more slices than there are hues', () => {
    for (const n of [1, 6, 7, 20, 100]) {
      const out = foldCategorySlices(slices(...Array.from({ length: n }, (_, i) => i + 1)), OTHER);
      expect(out.length).toBeLessThanOrEqual(PIE_SLICE_LIMIT);
    }
  });
});
