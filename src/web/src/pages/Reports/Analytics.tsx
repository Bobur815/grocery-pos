import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Select } from "@components/common/Select";
import { DateInput } from "@components/common/DateInput";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import {
  parseUztDate,
  uztDayEnd,
  uztDayStart,
  uztToday,
} from "../../utils/uzt-date";
import { analytics as analyticsApi } from "../../api/client";

// ── Types ────────────────────────────────────────────────────────────────────

type DatePreset =
  | "today"
  | "weekStart"
  | "last7"
  | "monthStart"
  | "last30"
  | "yearStart"
  | "last365"
  | "custom";

/** Which measure the top/worst product lists are ordered by. */
type RankMetric = "quantity" | "revenue" | "profit";

interface RankedProduct {
  productId: number;
  nameRu: string;
  nameUz: string;
  quantity: number;
  revenue: number;
  /** Null when the product has no cost price — an unknown margin, not a zero one. */
  profit: number | null;
}

interface ProductRanking {
  byQuantity: { top: RankedProduct[]; bottom: RankedProduct[] };
  byRevenue: { top: RankedProduct[]; bottom: RankedProduct[] };
  byProfit: { top: RankedProduct[]; bottom: RankedProduct[] };
  neverSoldCount: number;
  noCostCount: number;
  totalProducts: number;
}

interface AnalyticsData {
  salesTrend: { date: string; revenue: number; count: number }[];
  salesByCategory: {
    categoryRu: string;
    categoryUz: string;
    revenue: number;
    quantity: number;
  }[];
  hourlyDistribution: { hour: number; revenue: number; count: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  productRanking: ProductRanking;
  cashierPerformance: { name: string; revenue: number; count: number }[];
  profitMargins: {
    categoryRu: string;
    categoryUz: string;
    revenue: number;
    cost: number;
  }[];
  summary: {
    totalSales: number;
    totalRevenue: number;
    cashSales: number;
    cardSales: number;
    averageTransaction: number;
  };
}

// ── Date range helpers ────────────────────────────────────────────────────────

function getDateRange(
  preset: DatePreset,
  customStart?: string,
  customEnd?: string,
): { start: Date; end: Date } {
  const { y, m, d } = uztToday();
  const todayEnd = uztDayEnd(y, m, d);

  switch (preset) {
    case "today":
      return { start: uztDayStart(y, m, d), end: todayEnd };

    case "weekStart": {
      const dow = new Date(Date.UTC(y, m, d)).getUTCDay();
      const diff = dow === 0 ? -6 : 1 - dow;
      const ws = new Date(Date.UTC(y, m, d + diff));
      return { start: uztDayStart(ws.getUTCFullYear(), ws.getUTCMonth(), ws.getUTCDate()), end: todayEnd };
    }

    case "last7":
      return { start: uztDayStart(y, m, d - 6), end: todayEnd };

    case "monthStart":
      return { start: uztDayStart(y, m, 1), end: todayEnd };

    case "last30":
      return { start: uztDayStart(y, m, d - 29), end: todayEnd };

    case "yearStart":
      return { start: uztDayStart(y, 0, 1), end: todayEnd };

    case "last365":
      return { start: uztDayStart(y, m, d - 364), end: todayEnd };

    case "custom": {
      const s = customStart ? parseUztDate(customStart) : { y, m, d };
      const e = customEnd ? parseUztDate(customEnd) : { y, m, d };
      return { start: uztDayStart(s.y, s.m, s.d), end: uztDayEnd(e.y, e.m, e.d) };
    }
  }
}

// ── Styled components ─────────────────────────────────────────────────────────

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const Header = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const FilterRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-wrap: wrap;
`;

const PresetSelect = styled(Select)`
  min-width: 200px;
`;

const DateSep = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const KpiGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
`;

const KpiCard = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

const KpiLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const KpiValue = styled.div`
  font-size: 22px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const TwoCol = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.lg};

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

const CardTitle = styled.h3`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  color: ${({ theme }) => theme.colors.text};
  font-size: 16px;
`;

const NoData = styled.div`
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

const LoadingText = styled.div`
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: ${({ theme }) => theme.spacing.xl};
`;

const CardHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
  flex-wrap: wrap;
`;

const MetricSelect = styled(Select)`
  min-width: 220px;
`;

const RankNote = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const RankHeading = styled.h4`
  margin: 0 0 ${({ theme }) => theme.spacing.sm};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
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

// ── Ranking list ──────────────────────────────────────────────────────────────

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
function RankList({
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

// ── Component ─────────────────────────────────────────────────────────────────

export function Analytics() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();

  const [preset, setPreset] = useState<DatePreset>("monthStart");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // All three rankings ship in one response, so switching the metric is instant — no refetch.
  const [rankMetric, setRankMetric] = useState<RankMetric>("quantity");
  
  const lang = i18n.language as "ru" | "uz";
  const fmt = (amount: number) => formatCurrencyBase(amount, lang);

  const presetOptions = [
    { value: "today", label: t("reports.today") },
    { value: "weekStart", label: t("reports.thisWeek") },
    { value: "last7", label: t("reports.last7Days") },
    { value: "monthStart", label: t("reports.thisMonth") },
    { value: "last30", label: t("reports.last30Days") },
    { value: "yearStart", label: t("reports.thisYear") },
    { value: "last365", label: t("reports.last365Days") },
    { value: "custom", label: t("reports.custom") },
  ];

  const fetchData = useCallback(async () => {
    if (preset === "custom" && (!customStart || !customEnd)) return;
    setIsLoading(true);
    try {
      const { start, end } = getDateRange(preset, customStart, customEnd);
      const result = await analyticsApi.getData({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
      setData(result as AnalyticsData);
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [preset, customStart, customEnd]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Prepare localised data
  const categoryData =
    data?.salesByCategory.map((c) => ({
      name: lang === "ru" ? c.categoryRu : c.categoryUz,
      revenue: c.revenue,
    })) ?? [];

  const profitData =
    data?.profitMargins.map((c) => ({
      name: lang === "ru" ? c.categoryRu : c.categoryUz,
      revenue: c.revenue,
      cost: c.cost,
    })) ?? [];

  const metricOptions = [
    { value: "quantity", label: t("reports.rankByQuantity", "По количеству") },
    { value: "revenue", label: t("reports.rankByRevenue", "По выручке") },
    { value: "profit", label: t("reports.rankByProfit", "По прибыли") },
  ];

  const ranking = data?.productRanking;
  const rankSlice =
    rankMetric === "revenue"
      ? ranking?.byRevenue
      : rankMetric === "profit"
        ? ranking?.byProfit
        : ranking?.byQuantity;

  /** The figure the current metric ranks on. Profit is null-safe: no cost price → no row here. */
  const metricValue = (p: RankedProduct): number =>
    rankMetric === "revenue"
      ? p.revenue
      : rankMetric === "profit"
        ? (p.profit ?? 0)
        : p.quantity;

  const formatMetric = (p: RankedProduct): string =>
    rankMetric === "quantity" ? String(p.quantity) : fmt(metricValue(p));

  const PRIMARY = theme.colors.primary;
  const SUCCESS = theme.colors.success;
  const WARNING = theme.colors.warning;
  const ERROR = theme.colors.error;
  const INFO = theme.colors.info;
  const BORDER = theme.colors.border;
  const TEXT_SEC = theme.colors.textSecondary;

  const tickStyle = { fontSize: 11, fill: TEXT_SEC };

  const isDark = theme.colors.text === "#ffffff";
  const tooltipStyle = {
    backgroundColor: theme.colors.surface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: "6px",
    color: theme.colors.text,
    fontSize: 13,
  };
  const tooltipCursor = {
    stroke: BORDER,
    fill: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
  };

  return (
    <Container>
      {/* ── Header / Filters ── */}
      <Header>
        <Title>{t("reports.analytics")}</Title>

        <FilterRow>
          <PresetSelect
            options={presetOptions}
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePreset)}
          />
          {preset === "custom" && (
            <>
              <DateInput
                value={customStart}
                onChange={(val) => setCustomStart(val)}
              />
              <DateSep>—</DateSep>
              <DateInput
                value={customEnd}
                onChange={(val) => setCustomEnd(val)}
              />
            </>
          )}
        </FilterRow>
      </Header>

      {isLoading && <LoadingText>{t("common.loading")}</LoadingText>}

      {data && (
        <>
          {/* ── KPI summary ── */}
          <KpiGrid>
            <KpiCard>
              <KpiLabel>{t("reports.totalRevenue")}</KpiLabel>
              <KpiValue>{fmt(data.summary.totalRevenue)}</KpiValue>
            </KpiCard>
            <KpiCard>
              <KpiLabel>{t("reports.totalSales")}</KpiLabel>
              <KpiValue>{data.summary.totalSales}</KpiValue>
            </KpiCard>
            <KpiCard>
              <KpiLabel>{t("reports.averageTransaction")}</KpiLabel>
              <KpiValue>{fmt(data.summary.averageTransaction)}</KpiValue>
            </KpiCard>
            <KpiCard>
              <KpiLabel>
                {t("reports.cashPayments")} / {t("reports.cardPayments")}
              </KpiLabel>
              <KpiValue>
                {data.summary.cashSales} / {data.summary.cardSales}
              </KpiValue>
            </KpiCard>
          </KpiGrid>

          {/* ── Sales Trend (full width) ── */}
          <Card>
            <CardTitle>{t("reports.salesTrend")}</CardTitle>
            {data.salesTrend.length === 0 ? (
              <NoData>{t("reports.noData")}</NoData>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart
                  data={data.salesTrend}
                  margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="date" tick={tickStyle} />
                  <YAxis
                    tickFormatter={(v: number) => fmt(v)}
                    tick={tickStyle}
                    width={100}
                  />
                  <Tooltip
                    formatter={(v: any) => [fmt(v ?? 0), t("reports.revenue")]}
                    contentStyle={tooltipStyle}
                    cursor={{ stroke: BORDER }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={PRIMARY}
                    fill={PRIMARY + "33"}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* ── Hourly | By Category ── */}
          <TwoCol>
            <Card>
              <CardTitle>{t("reports.hourlyDistribution")}</CardTitle>
              {(() => {
                const fullDay = Array.from({ length: 24 }, (_, h) => {
                  const found = data.hourlyDistribution.find((d) => d.hour === h);
                  return { hour: h, revenue: found?.revenue ?? 0, count: found?.count ?? 0 };
                });
                return (
                  <ResponsiveContainer width="100%" height={210}>
                    <BarChart
                      data={fullDay}
                      margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                      <XAxis
                        dataKey="hour"
                        ticks={[0, 3, 6, 9, 12, 15, 18, 21, 23]}
                        tickFormatter={(h: number) =>
                          `${String(h).padStart(2, "0")}:00`
                        }
                        tick={tickStyle}
                      />
                      <YAxis tick={tickStyle} allowDecimals={false} />
                      <Tooltip
                        formatter={(v: any) => [v ?? 0, t("reports.transactions")]}
                        labelFormatter={(h) => {
                          const hh = String(Number(h)).padStart(2, "0");
                          const end = Number(h) === 23 ? "23:59" : `${String(Number(h) + 1).padStart(2, "0")}:00`;
                          return `${hh}:00 – ${end}`;
                        }}
                        contentStyle={tooltipStyle}
                        cursor={tooltipCursor}
                      />
                      <Bar dataKey="count" fill={PRIMARY} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </Card>

            <Card>
              <CardTitle>{t("reports.salesByCategory")}</CardTitle>
              {categoryData.length === 0 ? (
                <NoData>{t("reports.noData")}</NoData>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart
                    data={categoryData}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                    <XAxis
                      type="number"
                      tickFormatter={(v: number) => fmt(v)}
                      tick={tickStyle}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tick={tickStyle}
                    />
                    <Tooltip
                      formatter={(v: any) => [
                        fmt(v ?? 0),
                        t("reports.revenue"),
                      ]}
                      contentStyle={tooltipStyle}
                      cursor={tooltipCursor}
                    />
                    <Bar dataKey="revenue" fill={INFO} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </TwoCol>

          {/* ── Product rankings (full width, one filter drives both lists) ── */}
          <Card>
            <CardHead>
              <CardTitle style={{ margin: 0 }}>
                {t("reports.productRankings", "Рейтинг товаров")}
              </CardTitle>
              <MetricSelect
                options={metricOptions}
                value={rankMetric}
                onChange={(e) => setRankMetric(e.target.value as RankMetric)}
                selectSize="small"
              />
            </CardHead>

            {/* What the lists are drawn from. Without this the worst-sellers list looks like a
                complete answer, when it is ten rows sampled from however many never sold. */}
            <RankNote>
              {t("reports.rankScope", {
                defaultValue:
                  "Из {{total}} активных товаров. Не продавалось ни разу: {{neverSold}}.",
                total: ranking?.totalProducts ?? 0,
                neverSold: ranking?.neverSoldCount ?? 0,
              })}
              {rankMetric === "profit" && (ranking?.noCostCount ?? 0) > 0 && (
                <>
                  {" "}
                  {t("reports.rankNoCost", {
                    defaultValue:
                      "Без себестоимости — не учитывается в прибыли: {{count}}.",
                    count: ranking?.noCostCount ?? 0,
                  })}
                </>
              )}
            </RankNote>

            <TwoCol>
              <div>
                <RankHeading>{t("reports.bestSellers", "Лучшие 10")}</RankHeading>
                <RankList
                  rows={rankSlice?.top ?? []}
                  lang={lang}
                  color={SUCCESS}
                  metricValue={metricValue}
                  formatMetric={formatMetric}
                  emptyLabel={t("reports.noData")}
                />
              </div>
              <div>
                <RankHeading>{t("reports.worstSellers", "Худшие 10")}</RankHeading>
                <RankList
                  rows={rankSlice?.bottom ?? []}
                  lang={lang}
                  color={ERROR}
                  metricValue={metricValue}
                  formatMetric={formatMetric}
                  emptyLabel={t("reports.noData")}
                />
              </div>
            </TwoCol>
          </Card>

          {/* ── Cashier Performance (full width — it lost its former row partner to the
              rankings block above, and a half-width chart beside empty space reads as broken) ── */}
          <Card>
              <CardTitle>{t("reports.cashierPerformance")}</CardTitle>
              {data.cashierPerformance.length === 0 ? (
                <NoData>{t("reports.noData")}</NoData>
              ) : (
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart
                    data={data.cashierPerformance}
                    margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                    <XAxis dataKey="name" tick={tickStyle} />
                    <YAxis
                      tickFormatter={(v: number) => fmt(v)}
                      tick={tickStyle}
                      width={100}
                    />
                    <Tooltip
                      formatter={(v: any) => [
                        fmt(v ?? 0),
                        t("reports.revenue"),
                      ]}
                      contentStyle={tooltipStyle}
                      cursor={tooltipCursor}
                    />
                    <Bar
                      dataKey="revenue"
                      fill={WARNING}
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
          </Card>

          {/* ── Profit Margins (full width) ── */}
          <Card>
            <CardTitle>{t("reports.profitMargins")}</CardTitle>
            {profitData.length === 0 ? (
              <NoData>{t("reports.noData")}</NoData>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart
                  data={profitData}
                  margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
                  <XAxis dataKey="name" tick={tickStyle} />
                  <YAxis
                    tickFormatter={(v: number) => fmt(v)}
                    tick={tickStyle}
                    width={100}
                  />
                  <Tooltip
                    formatter={(v: any) => [fmt(v ?? 0), ""]}
                    contentStyle={tooltipStyle}
                    cursor={tooltipCursor}
                  />
                  <Legend />
                  <Bar
                    dataKey="revenue"
                    name={t("reports.revenue")}
                    fill={PRIMARY}
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="cost"
                    name={t("reports.cost")}
                    fill={ERROR}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </>
      )}

      {!isLoading && !data && <NoData>{t("reports.noData")}</NoData>}
    </Container>
  );
}
