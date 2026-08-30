import { rankProducts, RANK_LIMIT, type ProductPerformanceRow } from './analytics.ranking';

function row(over: Partial<ProductPerformanceRow> & { productId: number }): ProductPerformanceRow {
  return {
    nameRu: `Товар ${over.productId}`,
    nameUz: `Mahsulot ${over.productId}`,
    quantity: 0,
    revenue: 0,
    cost: 0,
    hasCost: true,
    ...over,
  };
}

describe('rankProducts', () => {
  it('ranks best and worst by units sold', () => {
    const r = rankProducts([
      row({ productId: 1, quantity: 100 }),
      row({ productId: 2, quantity: 5 }),
      row({ productId: 3, quantity: 50 }),
    ]);
    expect(r.byQuantity.top.map((p) => p.productId)).toEqual([1, 3, 2]);
    expect(r.byQuantity.bottom.map((p) => p.productId)).toEqual([2, 3, 1]);
  });

  it('computes profit as revenue minus cost', () => {
    const r = rankProducts([row({ productId: 1, quantity: 10, revenue: 50_000, cost: 30_000 })]);
    expect(r.byProfit.top[0].profit).toBe(20_000);
  });

  it('excludes products with no cost price from profit rankings only', () => {
    const rows = [
      row({ productId: 1, quantity: 10, revenue: 50_000, cost: 30_000 }),
      row({ productId: 2, quantity: 99, revenue: 90_000, cost: 0, hasCost: false }),
    ];
    const r = rankProducts(rows);

    // Absent from both ends of the profit ranking...
    expect(r.byProfit.top.map((p) => p.productId)).toEqual([1]);
    expect(r.byProfit.bottom.map((p) => p.productId)).toEqual([1]);
    expect(r.noCostCount).toBe(1);

    // ...but still ranked on quantity and revenue, where cost is irrelevant.
    expect(r.byQuantity.top[0].productId).toBe(2);
    expect(r.byRevenue.top[0].productId).toBe(2);
  });

  it('reports an unknown margin as null, never as zero profit', () => {
    const r = rankProducts([row({ productId: 1, revenue: 10_000, hasCost: false })]);
    expect(r.byQuantity.top[0].profit).toBeNull();
  });

  it('ranks never-sold products as the worst sellers', () => {
    const r = rankProducts([
      row({ productId: 1, quantity: 100, revenue: 500_000, cost: 300_000 }),
      row({ productId: 2, quantity: 1, revenue: 5_000, cost: 3_000 }),
      row({ productId: 3, quantity: 0 }), // never sold
    ]);
    expect(r.byQuantity.bottom[0].productId).toBe(3);
    expect(r.byRevenue.bottom[0].productId).toBe(3);
    expect(r.neverSoldCount).toBe(1);
  });

  it('surfaces a loss-making product below a product that simply never sold', () => {
    // Sold at below cost: a real problem, and it must outrank inert stock in "least profitable".
    const r = rankProducts([
      row({ productId: 1, quantity: 10, revenue: 10_000, cost: 40_000 }), // −30k
      row({ productId: 2, quantity: 0 }), // 0
    ]);
    expect(r.byProfit.bottom.map((p) => p.productId)).toEqual([1, 2]);
    expect(r.byProfit.bottom[0].profit).toBe(-30_000);
  });

  it('breaks ties by name so the worst-sellers list is stable between refreshes', () => {
    // Realistic dead-stock case: many products at zero. Without a deterministic secondary key
    // the list would reshuffle on every reload and read as though stock had moved.
    const zeros = [
      row({ productId: 3, nameRu: 'Ваниль' }),
      row({ productId: 1, nameRu: 'Апельсин' }),
      row({ productId: 2, nameRu: 'Банан' }),
    ];
    const first = rankProducts(zeros).byQuantity.bottom.map((p) => p.nameRu);
    const second = rankProducts([...zeros].reverse()).byQuantity.bottom.map((p) => p.nameRu);
    expect(first).toEqual(['Апельсин', 'Банан', 'Ваниль']);
    expect(second).toEqual(first);
  });

  it('stays stable when two products share a name', () => {
    // Postgres gives no row order without an ORDER BY, so identical names must still resolve.
    const dupes = [row({ productId: 7, nameRu: 'Хлеб' }), row({ productId: 4, nameRu: 'Хлеб' })];
    expect(rankProducts(dupes).byQuantity.bottom.map((p) => p.productId)).toEqual([4, 7]);
    expect(rankProducts([...dupes].reverse()).byQuantity.bottom.map((p) => p.productId)).toEqual([
      4, 7,
    ]);
  });

  it('caps each list at ten entries', () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ productId: i + 1, quantity: i + 1, revenue: (i + 1) * 1000, cost: 0 }),
    );
    const r = rankProducts(rows);
    expect(r.byQuantity.top).toHaveLength(RANK_LIMIT);
    expect(r.byQuantity.bottom).toHaveLength(RANK_LIMIT);
    expect(r.byQuantity.top[0].quantity).toBe(25);
    expect(r.byQuantity.bottom[0].quantity).toBe(1);
    expect(r.totalProducts).toBe(25);
  });

  it('handles an empty catalog without throwing', () => {
    const r = rankProducts([]);
    expect(r.byQuantity.top).toEqual([]);
    expect(r.byProfit.bottom).toEqual([]);
    expect(r.neverSoldCount).toBe(0);
    expect(r.totalProducts).toBe(0);
  });
});
