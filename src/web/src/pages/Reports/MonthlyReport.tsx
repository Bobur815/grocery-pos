import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import styled, { type DefaultTheme } from "styled-components";
import { Button } from "@components/common/Button";
import { Pagination } from "@components/common/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useSales } from "../../hooks/useSales";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { UZQR_BRAND_COLOR } from "@shared/constants";
import { formatDateTime } from "../../utils/formatters";
import {
  SubNav,
  useReportsSubNav,
  REPORTS_HIDE_TABS_ON_MOBILE,
} from "../../components/layout/SubNav";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const FilterRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  align-items: center;
`;

const Select = styled.select`
  padding: ${({ theme }) => theme.spacing.md};
  font-size: 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
`;

const StatCard = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

const StatLabel = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const StatValue = styled.div`
  font-size: 24px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.text};
`;

const StatSubtext = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const TableCard = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  overflow: hidden;
`;

const TableCardHeader = styled.div`
  padding: ${({ theme }) => `${theme.spacing.md} ${theme.spacing.lg}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text};
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Th = styled.th`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  white-space: nowrap;
`;

const Td = styled.td`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Tr = styled.tr`
  &:last-child td {
    border-bottom: none;
  }
  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
  }
`;

/** Green = drawer, house blue = bank card, navy = the UzQR brand. */
function tenderColor(theme: DefaultTheme, method: string) {
  if (method === "uzqr") return UZQR_BRAND_COLOR;
  return method === "cash" ? theme.colors.success : theme.colors.primary;
}

/** Emoji cue beside the tender label. */
const TENDER_ICONS: Record<string, string> = {
  cash: "💵",
  card: "💳",
  uzqr: "🔳",
};

const PaymentBadge = styled.span<{ $method: string }>`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 12px;
  background-color: ${({ theme, $method }) => tenderColor(theme, $method) + "20"};
  color: ${({ theme, $method }) => tenderColor(theme, $method)};
  font-weight: 500;
`;

const EmptyCell = styled.div`
  padding: ${({ theme }) => theme.spacing.xl};
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function MonthlyReport() {
  const { t, i18n } = useTranslation();
  const { loadSales, sales, isLoading } = useSales();

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [generated, setGenerated] = useState(false);

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");


  const handleGenerateReport = async () => {
    const startDate = new Date(selectedYear, selectedMonth, 1);
    const endDate = new Date(
      selectedYear,
      selectedMonth + 1,
      0,
      23,
      59,
      59,
      999,
    );
    await loadSales({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
    setGenerated(true);
  };

  const {
    pageData: pagedSales,
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    pageSizeOptions,
    goToPage,
    setPageSize,
  } = usePagination(sales);

  // Stats computed from loaded sales
  const totalRevenue = sales.reduce((sum, s) => sum + Number(s.finalAmount), 0);
  const cashCount = sales.filter((s) => s.paymentMethod === "cash").length;
  const cardCount = sales.filter((s) => s.paymentMethod === "card").length;
  const uzqrCount = sales.filter((s) => s.paymentMethod === "uzqr").length;
  const totalItemsSold = sales.reduce((sum, s) => sum + s.items.length, 0);
  const avgTransaction = sales.length > 0 ? totalRevenue / sales.length : 0;

  const subNav = useReportsSubNav();

  return (
    <Container>
      {/* Section tabs — the mobile bar carries sections only, so a section's sibling
          pages live here. See components/layout/SubNav.tsx. */}
      <SubNav items={subNav} hideOnMobile={REPORTS_HIDE_TABS_ON_MOBILE} />
      <Title>{t("reports.monthlyReport")}</Title>

      <FilterRow>
        <Select
          value={selectedMonth}
          onChange={(e) => {
            setSelectedMonth(Number(e.target.value));
            setGenerated(false);
          }}
        >
          {months.map((month, index) => (
            <option key={month} value={index}>
              {month}
            </option>
          ))}
        </Select>

        <Select
          value={selectedYear}
          onChange={(e) => {
            setSelectedYear(Number(e.target.value));
            setGenerated(false);
          }}
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Select>

        <Button onClick={handleGenerateReport} disabled={isLoading}>
          {isLoading ? t("common.loading") : t("reports.generateReport")}
        </Button>
      </FilterRow>

      {generated && !isLoading && (
        <>
          <StatsGrid>
            <StatCard>
              <StatLabel>{t("reports.totalSales")}</StatLabel>
              <StatValue>{sales.length}</StatValue>
              <StatSubtext>{t("reports.transactions")}</StatSubtext>
            </StatCard>

            <StatCard>
              <StatLabel>{t("reports.totalRevenue")}</StatLabel>
              <StatValue>{formatCurrency(totalRevenue)}</StatValue>
              <StatSubtext>
                {months[selectedMonth]} {selectedYear}
              </StatSubtext>
            </StatCard>

            <StatCard>
              <StatLabel>{t("reports.averageTransaction")}</StatLabel>
              <StatValue>{formatCurrency(avgTransaction)}</StatValue>
              <StatSubtext>{t("reports.perSale")}</StatSubtext>
            </StatCard>

            <StatCard>
              <StatLabel>{t("reports.itemsSold")}</StatLabel>
              <StatValue>{totalItemsSold}</StatValue>
              <StatSubtext>{t("reports.items")}</StatSubtext>
            </StatCard>

            <StatCard>
              <StatLabel>{t("reports.cashPayments")}</StatLabel>
              <StatValue>{cashCount}</StatValue>
              <StatSubtext>{t("reports.transactions")}</StatSubtext>
            </StatCard>

            <StatCard>
              <StatLabel>{t("reports.cardPayments")}</StatLabel>
              <StatValue>{cardCount}</StatValue>
              <StatSubtext>{t("reports.transactions")}</StatSubtext>
            </StatCard>

            {/* Only worth a tile once the store actually takes UzQR. */}
            {uzqrCount > 0 && (
              <StatCard>
                <StatLabel>{t("reports.uzqrPayments")}</StatLabel>
                <StatValue>{uzqrCount}</StatValue>
                <StatSubtext>{t("reports.transactions")}</StatSubtext>
              </StatCard>
            )}
          </StatsGrid>

          <TableCard>
            <TableCardHeader>
              <SectionTitle>{t("reports.receipts")}</SectionTitle>
            </TableCardHeader>

            {!sales.length ? (
              <EmptyCell>{t("reports.noData")}</EmptyCell>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("reports.time")}</Th>
                    <Th>{t("pos.receiptNumber")}</Th>
                    <Th>{t("reports.cashier")}</Th>
                    <Th style={{ textAlign: "center" }}>{t("pos.items")}</Th>
                    <Th>{t("reports.payment")}</Th>
                    <Th style={{ textAlign: "right" }}>
                      {t("reports.amount")}
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSales.map((sale) => (
                    <Tr key={sale.id}>
                      <Td style={{ whiteSpace: "nowrap" }}>
                        {formatDateTime(sale.createdAt)}
                      </Td>
                      <Td style={{ fontFamily: "monospace" }}>
                        #{sale.receiptNumber}
                      </Td>
                      <Td>{sale.cashierName}</Td>
                      <Td style={{ textAlign: "center" }}>
                        {sale.items.length}
                      </Td>
                      <Td>
                        <PaymentBadge $method={sale.paymentMethod}>
                          {TENDER_ICONS[sale.paymentMethod] ?? "💳"}{" "}
                          {t(`pos.${sale.paymentMethod}`)}
                        </PaymentBadge>
                      </Td>
                      <Td style={{ textAlign: "right", fontWeight: 600 }}>
                        {formatCurrency(Number(sale.finalAmount))}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {sales.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                pageSizeOptions={pageSizeOptions}
                onPageChange={goToPage}
                onPageSizeChange={setPageSize}
              />
            )}
          </TableCard>
        </>
      )}

      {!generated && !isLoading && (
        <EmptyCell style={{ background: "transparent" }}>
          {t("reports.selectPeriod")}
        </EmptyCell>
      )}
    </Container>
  );
}
