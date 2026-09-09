import styled from "styled-components";

/**
 * The product-rankings block, shared by the POS terminal's analytics screen and the web
 * dashboard's.
 *
 * Both render the same report from three different backends (the Nest service, the terminal's
 * LAN server, and the analytics IPC handler), so the *presentation* is the one thing that has no
 * excuse to differ. Everything here is pure — no data fetching, no routing — and each page keeps
 * its own layout and its own way of getting the numbers.
 */

/** One product's standing over the reporting period. Mirrors the server's `RankedProduct`. */
export interface RankedProduct {
  productId: number;
  nameRu: string;
  nameUz: string;
  quantity: number;
  revenue: number;
  /** Null when the product has no cost price — an unknown margin, not a zero one. */
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
  neverSoldCount: number;
  noCostCount: number;
  totalProducts: number;
}

/** A category the rankings can be narrowed to. */
export interface RankingCategory {
  id: number;
  nameRu: string;
  nameUz: string;
}

/** Which measure the top/bottom lists are ordered by. */
export type RankMetric = "quantity" | "revenue" | "profit";

/** The figure the chosen metric ranks on. Profit is null-safe: no cost price → no row here. */
export function metricValueOf(p: RankedProduct, metric: RankMetric): number {
  if (metric === "revenue") return p.revenue;
  if (metric === "profit") return p.profit ?? 0;
  return p.quantity;
}

/** The ranking slice for a metric, or undefined before the data has arrived. */
export function sliceFor(
  ranking: ProductRanking | undefined,
  metric: RankMetric,
): RankingSlice | undefined {
  if (metric === "revenue") return ranking?.byRevenue;
  if (metric === "profit") return ranking?.byProfit;
  return ranking?.byQuantity;
}

const NoData = styled.div`
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

export const RankHeading = styled.h4`
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

export const RankNote = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const RankTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
`;

const RankRow = styled.tr`
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const RankIndex = styled.td`
  padding: ${({ theme }) => theme.spacing.xs} 0;
  width: 22px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-variant-numeric: tabular-nums;
`;

const RankName = styled.td`
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  color: ${({ theme }) => theme.colors.text};
`;

/** Fixed width so the numbers form a column the eye can scan, independent of name length. */
const RankValue = styled.td<{ $tone?: "bad" | "muted" }>`
  padding: ${({ theme }) => theme.spacing.xs} 0;
  width: 108px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${({ theme, $tone }) =>
    $tone === "bad"
      ? theme.colors.error
      : $tone === "muted"
        ? theme.colors.textSecondary
        : theme.colors.text};
`;

/**
 * Inline proportional bar, in place of a chart.
 *
 * A bar chart is unreadable for the worst-sellers list — most of its entries are zero, so every
 * bar collapses to nothing. Scaling each table to its own maximum keeps the comparison visible
 * within a list while the exact figure stays on the row.
 */
const BarCell = styled.td`
  width: 76px;
  padding: ${({ theme }) => theme.spacing.xs} 0
    ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
`;

const BarTrack = styled.div`
  height: 6px;
  border-radius: 3px;
  background-color: ${({ theme }) => theme.colors.border};
  overflow: hidden;
`;

const BarFill = styled.div<{ $pct: number; $color: string }>`
  height: 100%;
  width: ${({ $pct }) => $pct}%;
  background-color: ${({ $color }) => $color};
`;

interface RankListProps {
  rows: RankedProduct[];
  lang: "ru" | "uz";
  color: string;
  metricValue: (p: RankedProduct) => number;
  formatMetric: (p: RankedProduct) => string;
  emptyLabel: string;
}

/**
 * Ten products with an inline proportional bar, used instead of a Recharts bar chart.
 *
 * The worst-sellers list is mostly zeros — a chart of it renders as ten invisible bars and a
 * column of truncated labels. A table keeps the names readable and the figures exact, and the
 * bar still carries the visual comparison where there is one to make.
 */
export function RankList({
  rows,
  lang,
  color,
  metricValue,
  formatMetric,
  emptyLabel,
}: RankListProps) {
  if (rows.length === 0) return <NoData>{emptyLabel}</NoData>;

  // Scaled to this list's own maximum, not the other list's: the worst-sellers bars are about
  // comparing dead stock with itself, and sharing a scale with the best sellers would flatten
  // every one of them to nothing.
  const peak = Math.max(...rows.map((r) => Math.abs(metricValue(r))), 0);

  return (
    <RankTable>
      <tbody>
        {rows.map((p, i) => {
          const value = metricValue(p);
          return (
            <RankRow key={p.productId}>
              <RankIndex>{i + 1}</RankIndex>
              <RankName>{lang === "ru" ? p.nameRu : p.nameUz}</RankName>
              <BarCell>
                <BarTrack>
                  <BarFill
                    $pct={peak > 0 ? (Math.abs(value) / peak) * 100 : 0}
                    $color={color}
                  />
                </BarTrack>
              </BarCell>
              {/* A negative figure is a product sold below cost — worth seeing in red. */}
              <RankValue $tone={value < 0 ? "bad" : value === 0 ? "muted" : undefined}>
                {formatMetric(p)}
              </RankValue>
            </RankRow>
          );
        })}
      </tbody>
    </RankTable>
  );
}
