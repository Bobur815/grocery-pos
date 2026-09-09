/**
 * Top / bottom product rankings for the analytics page.
 *
 * Kept DB-free so the ordering rules — especially the ones about missing cost and never-sold
 * products — are testable without a database.
 */

/** One product's performance over the reporting period. */
export interface ProductPerformanceRow {
  productId: number;
  nameRu: string;
  nameUz: string;
  /** In pieces: sale_items.quantity × pieces_per_unit. */
  quantity: number;
  revenue: number;
  /** Quantity sold valued at the product's cost. Meaningless when `hasCost` is false. */
  cost: number;
  /** False when Product.cost is null — the product is then excluded from profit rankings. */
  hasCost: boolean;
  /** The product's category, so the rankings can be narrowed to one. */
  categoryId: number;
  categoryRu: string;
  categoryUz: string;
}

/** A category present among the ranked products, for the UI's filter. */
export interface RankingCategory {
  id: number;
  nameRu: string;
  nameUz: string;
}

/**
 * The categories the ranked products actually belong to, name-sorted.
 *
 * Derived from the same rows the rankings are built from rather than fetched separately, so the
 * filter can never offer a category that would rank empty.
 */
export function rankingCategories(rows: ProductPerformanceRow[]): RankingCategory[] {
  const byId = new Map<number, RankingCategory>();
  for (const r of rows) {
    if (!byId.has(r.categoryId)) {
      byId.set(r.categoryId, { id: r.categoryId, nameRu: r.categoryRu, nameUz: r.categoryUz });
    }
  }
  return [...byId.values()].sort((a, b) => a.nameRu.localeCompare(b.nameRu, 'ru'));
}

export interface RankedProduct {
  productId: number;
  nameRu: string;
  nameUz: string;
  quantity: number;
  revenue: number;
  /** revenue − cost. Null when the product has no cost price, never 0. */
  profit: number | null;
}

export interface RankingSlice {
  top: RankedProduct[];
  bottom: RankedProduct[];
}

export interface ProductRanking {
  byQuantity: RankingSlice;
  byRevenue: RankingSlice;
  byProfit: RankingSlice;
  /** Active products with no sales at all in the period — the bottom lists are a sample of these. */
  neverSoldCount: number;
  /** Active products excluded from the profit rankings for having no cost price. */
  noCostCount: number;
  /** Active products considered in total, so the UI can say what the lists are drawn from. */
  totalProducts: number;
}

export const RANK_LIMIT = 10;

function toRanked(r: ProductPerformanceRow): RankedProduct {
  return {
    productId: r.productId,
    nameRu: r.nameRu,
    nameUz: r.nameUz,
    quantity: r.quantity,
    revenue: r.revenue,
    // Null rather than 0: "we cannot know" must not be orderable alongside "earned nothing",
    // or products with no cost price would colonise the worst-profit list.
    profit: r.hasCost ? r.revenue - r.cost : null,
  };
}

/**
 * Sort descending for `top` and ascending for `bottom`, breaking ties by name.
 *
 * The tie-break is load-bearing, not cosmetic. A store typically has far more than ten products
 * that sold nothing, so without a deterministic secondary key the "worst sellers" list would
 * reshuffle between two refreshes of the same period and read as though stock had moved.
 */
function slice(rows: RankedProduct[], value: (r: RankedProduct) => number): RankingSlice {
  const byValueThenName = (a: RankedProduct, b: RankedProduct, dir: 1 | -1) => {
    const d = (value(a) - value(b)) * dir;
    if (d !== 0) return d;
    // Falls through to the id because two products can legitimately share a name, and Postgres
    // gives no row order without an ORDER BY — name alone would leave those two free to swap.
    const byName = a.nameRu.localeCompare(b.nameRu);
    return byName !== 0 ? byName : a.productId - b.productId;
  };

  return {
    top: [...rows].sort((a, b) => byValueThenName(a, b, -1)).slice(0, RANK_LIMIT),
    bottom: [...rows].sort((a, b) => byValueThenName(a, b, 1)).slice(0, RANK_LIMIT),
  };
}

export function rankProducts(rows: readonly ProductPerformanceRow[]): ProductRanking {
  const ranked = rows.map(toRanked);

  // Profit rankings run over a smaller population on purpose: a product with no cost price has
  // an unknown margin, and ranking it as if the margin were zero would put every uncosted
  // product at the bottom of "least profitable" and hide the ones actually losing money.
  const costed = ranked.filter((r) => r.profit !== null);

  return {
    byQuantity: slice(ranked, (r) => r.quantity),
    byRevenue: slice(ranked, (r) => r.revenue),
    byProfit: slice(costed, (r) => r.profit as number),
    neverSoldCount: ranked.filter((r) => r.quantity === 0).length,
    noCostCount: ranked.length - costed.length,
    totalProducts: ranked.length,
  };
}
