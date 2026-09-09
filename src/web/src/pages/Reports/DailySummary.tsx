import React, { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import styled, { type DefaultTheme } from "styled-components";
import { useSales } from "../../hooks/useSales";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { UZQR_BRAND_COLOR, type SaleTender } from "@shared/constants";
import { formatDateTime } from "../../utils/formatters";
import { Modal } from "@components/common/Modal";
import { Button } from "@renderer/components/common/Button";
import { Pagination } from "@components/common/Pagination";
import { DateInput } from "@components/common/DateInput";
import { usePagination } from "../../hooks/usePagination";
import { Eraser } from "lucide-react";
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

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.75rem;
  color: ${({ theme }) => theme.colors.text};

  @media (max-width: 768px) {
    font-size: 1.5rem;
  }
`;

const FilterBar = styled.div`
  display: flex;
  align-items: flex-end;
  gap: ${({ theme }) => theme.spacing.md};
  flex-wrap: wrap;
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

const FilterGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  
`;

const FilterLabel = styled.label`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const FilterSelect = styled.select`
  padding: 8px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 15px;
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
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
  font-size: 28px;
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

const ActionBtn = styled.button<{ $variant?: "danger" }>`
  padding: 4px 10px;
  font-size: 13px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid
    ${({ theme, $variant }) =>
      $variant === "danger" ? theme.colors.error : theme.colors.border};
  background: none;
  color: ${({ theme, $variant }) =>
    $variant === "danger" ? theme.colors.error : theme.colors.textSecondary};
  cursor: pointer;

  &:hover {
    background-color: ${({ theme, $variant }) =>
      $variant === "danger" ? theme.colors.error + "15" : theme.colors.border};
    color: ${({ theme, $variant }) =>
      $variant === "danger" ? theme.colors.error : theme.colors.text};
  }

  & + & {
    margin-left: 6px;
  }
`;

const ModalBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const ModalText = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const ModalBtn = styled.button<{ $variant?: "danger" }>`
  padding: 8px 18px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: none;
  font-size: 14px;
  cursor: pointer;
  background-color: ${({ theme, $variant }) =>
    $variant === "danger" ? theme.colors.error : theme.colors.border};
  color: ${({ theme, $variant }) =>
    $variant === "danger" ? "#fff" : theme.colors.text};

  &:hover {
    opacity: 0.85;
  }
`;

export function DailySummary() {
  const { t, i18n } = useTranslation();
  const { loadSales, deleteSale, sales, isLoading } = useSales();

  const todayStr = new Date().toISOString().split("T")[0];
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [paymentFilter, setPaymentFilter] = useState<"all" | SaleTender>(
    "all",
  );
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");


  useEffect(() => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    loadSales({ startDate: start.toISOString(), endDate: end.toISOString() });
  }, [startDate, endDate]);

  const filteredSales = useMemo(
    () =>
      paymentFilter === "all"
        ? sales
        : sales.filter((s) => s.paymentMethod === paymentFilter),
    [sales, paymentFilter],
  );

  const {
    pageData: pagedSales,
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    pageSizeOptions,
    goToPage,
    setPageSize,
  } = usePagination(filteredSales);

  const summary = useMemo(() => {
    if (!filteredSales.length) return null;
    const totalRevenue = filteredSales.reduce(
      (sum, s) => sum + Number(s.finalAmount),
      0,
    );
    const totalItems = filteredSales.reduce(
      (sum, s) => sum + s.items.length,
      0,
    );
    const cashSales = filteredSales.filter(
      (s) => s.paymentMethod === "cash",
    ).length;
    const cardSales = filteredSales.filter(
      (s) => s.paymentMethod === "card",
    ).length;
    const uzqrSales = filteredSales.filter(
      (s) => s.paymentMethod === "uzqr",
    ).length;
    const totalCost = filteredSales.reduce(
      (sum, s) => sum + (s.totalCost ?? 0),
      0,
    );
    const avgMargin =
      totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
    return {
      totalSales: filteredSales.length,
      totalRevenue,
      totalItems,
      cashSales,
      cardSales,
      uzqrSales,
      avgMargin,
    };
  }, [filteredSales]);

  const handleDeleteExecute = async () => {
    if (!deleteTargetId) return;
    await deleteSale(deleteTargetId);
    setDeleteTargetId(null);
  };

  const handleReset = () => {
    setStartDate(todayStr);
    setEndDate(todayStr);
    setPaymentFilter("all");
  };

  const subNav = useReportsSubNav();

  return (
    <Container>
      {/* Section tabs — the mobile bar carries sections only, so a section's sibling
          pages live here. See components/layout/SubNav.tsx. */}
      <SubNav items={subNav} hideOnMobile={REPORTS_HIDE_TABS_ON_MOBILE} />
      <HeaderRow>
        <Title>{t("reports.receipts")}</Title>
      </HeaderRow>

      <FilterBar>
        <FilterGroup>
          <FilterLabel>{t("reports.startDate")}</FilterLabel>
          <DateInput
            value={startDate}
            onChange={(val) => setStartDate(val)}
          />
        </FilterGroup>
        <FilterGroup>
          <FilterLabel>{t("reports.endDate")}</FilterLabel>
          <DateInput
            value={endDate}
            onChange={(val) => setEndDate(val)}
          />
        </FilterGroup>
        <FilterGroup>
          <FilterLabel>{t("reports.payment")}</FilterLabel>
          <FilterSelect
            value={paymentFilter}
            onChange={(e) =>
              setPaymentFilter(e.target.value as "all" | SaleTender)
            }
          >
            <option value="all">{t("reports.allPayments")}</option>
            <option value="cash">{t("pos.cash")}</option>
            <option value="card">{t("pos.card")}</option>
            <option value="uzqr">{t("pos.uzqr")}</option>
          </FilterSelect>
        </FilterGroup>
        <Button variant="secondary" size="medium" onClick={handleReset}>
          <Eraser size={18} /> {t("common.refresh")}
        </Button>
      </FilterBar>

      {summary && (
        <StatsGrid>
          <StatCard>
            <StatLabel>{t("reports.totalSales")}</StatLabel>
            <StatValue>{summary.totalSales}</StatValue>
            <StatSubtext>{t("reports.transactions")}</StatSubtext>
          </StatCard>

          <StatCard>
            <StatLabel>{t("reports.totalRevenue")}</StatLabel>
            <StatValue>{formatCurrency(summary.totalRevenue)}</StatValue>
            <StatSubtext>
              {startDate === endDate ? startDate : `${startDate} – ${endDate}`}
            </StatSubtext>
          </StatCard>

          <StatCard>
            <StatLabel>{t("reports.avgMargin")}</StatLabel>
            <StatValue>{summary.avgMargin.toFixed(1)}%</StatValue>
            <StatSubtext>{t("reports.perSale")}</StatSubtext>
          </StatCard>

          <StatCard>
            <StatLabel>{t("reports.itemsSold")}</StatLabel>
            <StatValue>{summary.totalItems}</StatValue>
            <StatSubtext>{t("reports.items")}</StatSubtext>
          </StatCard>

          <StatCard>
            <StatLabel>{t("reports.cashPayments")}</StatLabel>
            <StatValue>{summary.cashSales}</StatValue>
            <StatSubtext>{t("reports.transactions")}</StatSubtext>
          </StatCard>

          {/* Only worth a tile once the store actually takes UzQR. */}
          {summary.uzqrSales > 0 && (
            <StatCard>
              <StatLabel>{t("reports.uzqrPayments")}</StatLabel>
              <StatValue>{summary.uzqrSales}</StatValue>
              <StatSubtext>{t("reports.transactions")}</StatSubtext>
            </StatCard>
          )}

          <StatCard>
            <StatLabel>{t("reports.cardPayments")}</StatLabel>
            <StatValue>{summary.cardSales}</StatValue>
            <StatSubtext>{t("reports.transactions")}</StatSubtext>
          </StatCard>
        </StatsGrid>
      )}

      <TableCard>
        <TableCardHeader>
          <SectionTitle>{t("reports.receipts")}</SectionTitle>
        </TableCardHeader>

        {isLoading && !filteredSales.length ? (
          <EmptyCell>{t("common.loading")}</EmptyCell>
        ) : !filteredSales.length ? (
          <EmptyCell>{t("reports.noReceipts")}</EmptyCell>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("reports.dateTime")}</Th>
                <Th>{t("pos.receiptNumber")}</Th>
                <Th>{t("reports.cashier")}</Th>
                <Th style={{ textAlign: "center" }}>{t("pos.items")}</Th>
                <Th>{t("reports.payment")}</Th>
                <Th style={{ textAlign: "right" }}>{t("reports.amount")}</Th>
                <Th style={{ textAlign: "right" }}>{t("reports.cost")}</Th>
                <Th style={{ textAlign: "right" }}>{t("reports.margin")}</Th>
                <Th style={{ textAlign: "center" }}>{t("common.actions")}</Th>
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
                  <Td style={{ textAlign: "center" }}>{sale.items.length}</Td>
                  <Td>
                    <PaymentBadge $method={sale.paymentMethod}>
                      {TENDER_ICONS[sale.paymentMethod] ?? "💳"}{" "}
                      {t(`pos.${sale.paymentMethod}`)}
                    </PaymentBadge>
                  </Td>
                  <Td style={{ textAlign: "right", fontWeight: 600 }}>
                    {formatCurrency(Number(sale.finalAmount))}
                  </Td>
                  <Td
                    style={{
                      textAlign: "right",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {sale.totalCost != null
                      ? formatCurrency(sale.totalCost)
                      : "—"}
                  </Td>
                  <Td style={{ textAlign: "right", fontWeight: 600 }}>
                    {sale.margin != null ? `${sale.margin.toFixed(1)}%` : "—"}
                  </Td>
                  <Td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <ActionBtn
                      $variant="danger"
                      onClick={() => setDeleteTargetId(sale.id)}
                    >
                      {t("common.delete")}
                    </ActionBtn>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        {filteredSales.length > 0 && (
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

      {deleteTargetId && (
        <Modal
          title={t("common.delete")}
          onClose={() => setDeleteTargetId(null)}
        >
          <ModalBody>
            <ModalText>{t("common.confirmDelete")}</ModalText>
            <ModalActions>
              <ModalBtn onClick={() => setDeleteTargetId(null)}>
                {t("common.no")}
              </ModalBtn>
              <ModalBtn $variant="danger" onClick={handleDeleteExecute}>
                {t("common.yes")}
              </ModalBtn>
            </ModalActions>
          </ModalBody>
        </Modal>
      )}
    </Container>
  );
}
