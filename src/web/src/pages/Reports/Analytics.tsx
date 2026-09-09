import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import styled, { useTheme } from "styled-components";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
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
import {
  RankList,
  RankHeading,
  RankNote,
  metricValueOf,
  sliceFor,
  type RankedProduct,
  type ProductRanking,
  type RankingCategory,
  type RankMetric,
} from "@components/analytics/rankings";
import {
  CATEGORY_HUES_LIGHT,
  CATEGORY_HUES_DARK,
  foldCategorySlices,
} from "@components/analytics/categoryPie";
import {
  SubNav,
  useReportsSubNav,
  REPORTS_HIDE_TABS_ON_MOBILE,
} from "../../components/layout/SubNav";

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

// RankMetric, RankedProduct, ProductRanking and RankingCategory come from the shared module —
// the POS terminal's analytics screen renders the same block from a different backend.

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
  rankingCategories: RankingCategory[];
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
  grid-template-columns: repeat(auto-fit, minmax(150px, 2fr));
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
  min-width: 150px;
`;

/**
 * The filter row above the rankings: category sized to its content, metric taking the rest.
 *
 * Stacks below 600px instead of splitting a phone's width two ways — at that size `auto` and
 * `2fr` both land near 150px and the category names truncate to nothing useful.
 */
const CardControls = styled.div`
  display: grid;
  grid-template-columns: auto 2fr;
  gap: ${({ theme }) => theme.spacing.sm};

  @media (max-width: 600px) {
    grid-template-columns: 1fr;
  }
`;

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
  // The category, by contrast, DOES refetch: ranking has to happen within the category, and only
  // the server holds every product. "" is all categories.
  const [rankCategory, setRankCategory] = useState<string>("");
  
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
        ...(rankCategory ? { categoryId: Number(rankCategory) } : {}),
      });
      setData(result as AnalyticsData);
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [preset, customStart, customEnd, rankCategory]);
  
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Prepare localised data
  const categoryDataRaw =
    data?.salesByCategory.map((c) => ({
      name: lang === "ru" ? c.categoryRu : c.categoryUz,
      revenue: c.revenue,
    })) ?? [];

  const categoryData = foldCategorySlices(
    categoryDataRaw,
    t("reports.otherCategories", "Прочие"),
  );

  const categoryTotal = categoryData.reduce((sum, c) => sum + c.revenue, 0);

  const profitData =
    data?.profitMargins.map((c) => ({
      name: lang === "ru" ? c.categoryRu : c.categoryUz,
      revenue: c.revenue,
      cost: c.cost,
    })) ?? [];

  /**
   * All categories plus an "all" entry. Sourced from the response rather than the categories API
   * so the list can never offer one that would rank empty — and it survives a narrowed fetch,
   * because the server always derives it from the unfiltered rows.
   */
  const categoryOptions = [
    { value: "", label: t("reports.allCategories", "Все категории") },
    ...(data?.rankingCategories ?? []).map((c) => ({
      value: String(c.id),
      label: lang === "ru" ? c.nameRu : c.nameUz,
    })),
  ];

  const metricOptions = [
    { value: "quantity", label: t("reports.rankByQuantity", "По количеству") },
    { value: "revenue", label: t("reports.rankByRevenue", "По выручке") },
    { value: "profit", label: t("reports.rankByProfit", "По прибыли") },
  ];

  const ranking = data?.productRanking;
  const rankSlice = sliceFor(ranking, rankMetric);
  const metricValue = (p: RankedProduct): number => metricValueOf(p, rankMetric);

  const formatMetric = (p: RankedProduct): string =>
    rankMetric === "quantity" ? String(p.quantity) : fmt(metricValue(p));

  const PRIMARY = theme.colors.primary;
  const SUCCESS = theme.colors.success;
  const WARNING = theme.colors.warning;
  const ERROR = theme.colors.error;
  const BORDER = theme.colors.border;
  const TEXT_SEC = theme.colors.textSecondary;

  const tickStyle = { fontSize: 11, fill: TEXT_SEC };

  const isDark = theme.colors.text === "#ffffff";
  // Dark mode gets its own validated steps rather than an automatic lightening of the light ones.
  const CATEGORY_HUES = isDark ? CATEGORY_HUES_DARK : CATEGORY_HUES_LIGHT;
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

  const subNav = useReportsSubNav();

  return (
    <Container>
      {/* Section tabs — the mobile bar carries sections only, so a section's sibling
          pages live here. See components/layout/SubNav.tsx. */}
      <SubNav items={subNav} hideOnMobile={REPORTS_HIDE_TABS_ON_MOBILE} />
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
                  <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                    <Pie
                      data={categoryData}
                      dataKey="revenue"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={76}
                      // A 2px ring in the surface colour separates adjacent slices, so two
                      // neighbouring hues never touch — the gap does the work colour alone cannot
                      // for a red/green reader.
                      stroke={theme.colors.surface}
                      strokeWidth={2}
                      paddingAngle={1}
                      // The share, on the slice. The palette's lighter steps fall under 3:1
                      // against a light surface, and a visible label is the relief that makes
                      // that legal — it also stops the pie needing to be read by area alone.
                      label={({ percent }: any) =>
                        percent >= 0.05 ? `${Math.round(percent * 100)}%` : ""
                      }
                      labelLine={false}
                      isAnimationActive={false}
                    >
                      {categoryData.map((entry, i) => (
                        <Cell key={entry.name} fill={CATEGORY_HUES[i % CATEGORY_HUES.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: any, name: any) => [
                        `${fmt(v ?? 0)} · ${
                          categoryTotal > 0
                            ? Math.round(((v ?? 0) / categoryTotal) * 100)
                            : 0
                        }%`,
                        name,
                      ]}
                      contentStyle={tooltipStyle}
                    />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      iconType="circle"
                      iconSize={8}
                      formatter={(value: any) => (
                        <span style={{ fontSize: 11, color: TEXT_SEC }}>{value}</span>
                      )}
                    />
                  </PieChart>
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
              <CardControls>
                {/* Both filters drive the same two lists. Category refetches (the ranking must
                    happen within it, server-side); metric does not. */}
                <MetricSelect
                  options={categoryOptions}
                  value={rankCategory}
                  onChange={(e) => setRankCategory(e.target.value)}
                  selectSize="small"
                />
                <MetricSelect
                  options={metricOptions}
                  value={rankMetric}
                  onChange={(e) => setRankMetric(e.target.value as RankMetric)}
                  selectSize="small"
                />
              </CardControls>
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
