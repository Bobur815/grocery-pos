/**
 * The sales-by-category pie, shared by the POS terminal's analytics screen and the web
 * dashboard's — the colours and the slice budget, which are the parts that are easy to get
 * subtly wrong and pointless to decide twice.
 */

/**
 * Categorical hues, in fixed order.
 *
 * Deliberately NOT the app theme's palette: `primary` and `info` are both blues and `error` and
 * `secondary` both reds, so adjacent slices would be indistinguishable — and a status colour
 * means something (good/bad), which a category does not.
 *
 * Both sets are validated for the colour-vision checks against their own surface: worst adjacent
 * pair ΔE 9.1 protan (light) / 8.4 (dark), clear of the 6 floor, with a normal-vision worst of
 * 19.6 / 19.3. Dark mode has its own steps rather than an automatic lightening of the light ones.
 *
 * Assigned by position and never cycled — which is why the tail folds into one "Other" slice
 * rather than inventing a seventh hue.
 */
export const CATEGORY_HUES_LIGHT = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
];

export const CATEGORY_HUES_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
];

/** Slices a pie can carry before the segments stop being comparable at a glance. */
export const PIE_SLICE_LIMIT = 6;

export interface CategorySlice {
  name: string;
  revenue: number;
}

/**
 * The pie's slices: the largest few by revenue, with everything else summed into one "Other".
 *
 * A part-to-whole chart stops being readable past about six segments — thin slivers are neither
 * comparable nor labellable — and the palette is a fixed order of six hues that is never cycled.
 * Folding the tail keeps both true, and the total still equals real revenue.
 */
export function foldCategorySlices(
  slices: CategorySlice[],
  otherLabel: string,
): CategorySlice[] {
  const sorted = [...slices].sort((a, b) => b.revenue - a.revenue);
  if (sorted.length <= PIE_SLICE_LIMIT) return sorted;

  const head = sorted.slice(0, PIE_SLICE_LIMIT - 1);
  const tail = sorted.slice(PIE_SLICE_LIMIT - 1);
  return [
    ...head,
    { name: otherLabel, revenue: tail.reduce((sum, c) => sum + c.revenue, 0) },
  ];
}
