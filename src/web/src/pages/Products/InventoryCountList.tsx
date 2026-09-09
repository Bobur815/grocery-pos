import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import styled, { keyframes } from "styled-components";
import { ClipboardCheck, Plus, X } from "lucide-react";
import { Table } from "@components/common/Table";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import { Pagination } from "@components/common/Pagination";
import { EmptyPlaceholder } from "@components/common/EmptyPlaceholder";
import { useToast } from "@context/ToastContext";
import { formatCurrency } from "@shared/utils";
import { debounce } from "../../utils/helpers";
import { formatDateTime } from "../../utils/formatters";
import {
  MobileCard,
  MobileCardList,
  DesktopOnly,
} from "../../components/common/MobileCard";
import { CreateInventoryCountModal } from "./CreateInventoryCountModal";
import { InventoryCountStatusBadge } from "./InventoryCountStatusBadge";
import { SubNav, useStockSubNav } from "../../components/layout/SubNav";
import {
  inventoryCounts,
  type InventoryCountStatus,
  type InventoryCountSummary,
} from "../../api/client";

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  color: ${({ theme }) => theme.colors.text};
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};

  @media (max-width: 768px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const SearchWrapper = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
`;

const ClearBtn = styled.button`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Chips = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  flex-wrap: wrap;
`;

const Chip = styled.button<{ $active: boolean }>`
  padding: 6px 12px;
  border-radius: 16px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid
    ${({ theme, $active }) => ($active ? theme.colors.primary : theme.colors.border)};
  background-color: ${({ theme, $active }) =>
    $active ? `${theme.colors.primary}20` : theme.colors.surface};
  color: ${({ theme, $active }) =>
    $active ? theme.colors.primary : theme.colors.textSecondary};
`;

const Muted = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Diff = styled.span<{ $negative: boolean }>`
  color: ${({ theme, $negative }) =>
    $negative ? theme.colors.error : theme.colors.success};
  font-weight: 500;
`;

const WriteOffNote = styled.span`
  display: block;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.warning};
  white-space: nowrap;
`;

const NoteCell = styled.span`
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
`;

/* Floating create button — same treatment as the one on the suppliers list. */
const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 59, 130, 246), 0.5); }
  70% { box-shadow: 0 0 0 12px rgba(var(--primary-rgb, 59, 130, 246), 0); }
  100% { box-shadow: 0 0 0 0 rgba(var(--primary-rgb, 59, 130, 246), 0); }
`;

const FAB = styled.button`
  position: fixed;
  bottom: 50px;
  right: 16px;
  z-index: 100;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: none;
  background-color: ${({ theme }) => theme.colors.primary};
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  animation: ${pulse} 2s ease-out infinite;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.95);
  }
`;

const EmptyWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.xl} 0;
`;

const STATUS_FILTERS: Array<{ value: InventoryCountStatus | "ALL"; labelKey: string }> = [
  { value: "ALL", labelKey: "inventoryCount.allStatuses" },
  { value: "DRAFT", labelKey: "inventoryCount.status.draft" },
  { value: "IN_PROGRESS", labelKey: "inventoryCount.status.inProgress" },
  { value: "COMPLETED", labelKey: "inventoryCount.status.completed" },
  { value: "CANCELLED", labelKey: "inventoryCount.status.cancelled" },
];

export function InventoryCountList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [rows, setRows] = useState<InventoryCountSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState<InventoryCountStatus | "ALL">("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await inventoryCounts.list({
        page,
        limit: pageSize,
        ...(appliedSearch.trim() ? { search: appliedSearch.trim() } : {}),
        ...(status !== "ALL" ? { status } : {}),
      });
      setRows(data.rows);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch {
      toast.error(t("inventoryCount.loadError"));
    } finally {
      setIsLoading(false);
    }
    // `toast` and `t` are stable enough here; re-running on them would refetch on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, appliedSearch, status]);

  useEffect(() => {
    load();
  }, [load]);

  const debouncedSearch = useMemo(
    () =>
      debounce((query: string) => {
        setPage(1);
        setAppliedSearch(query);
      }, 300),
    [],
  );

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, debouncedSearch]);

  const formatMoney = (value: string) =>
    formatCurrency(Number(value), i18n.language as "ru" | "uz");

  /** Difference is only meaningful once the document is closed. */
  const renderDifference = (row: InventoryCountSummary) => {
    if (row.status !== "COMPLETED") return <Muted>—</Muted>;
    const qty = Number(row.totalDifference);
    return (
      <>
        <Diff $negative={qty < 0}>
          {qty > 0 ? "+" : ""}
          {qty} · {formatMoney(row.totalValueDiff)}
        </Diff>
        {/* A loss that came from a write-off reads very differently from a counted
            shortfall, so say which one it was without opening the document. */}
        {row.wroteOffUncounted && (
          <WriteOffNote>
            {t("inventoryCount.detail.writeOff.summary")}: {row.writtenOffItems} ·{" "}
            {formatMoney(row.writeOffValue)}
          </WriteOffNote>
        )}
      </>
    );
  };

  const columns = [
    {
      key: "number",
      header: t("inventoryCount.columns.number"),
      render: (row: InventoryCountSummary) => `#${row.number}`,
    },
    {
      key: "createdAt",
      header: t("inventoryCount.columns.openedAt"),
      render: (row: InventoryCountSummary) => formatDateTime(row.createdAt),
    },
    {
      key: "completedAt",
      header: t("inventoryCount.columns.closedAt"),
      render: (row: InventoryCountSummary) =>
        row.completedAt ? (
          formatDateTime(row.completedAt)
        ) : (
          <Muted>{t("inventoryCount.notClosed")}</Muted>
        ),
    },
    {
      key: "createdByName",
      header: t("inventoryCount.columns.employee"),
    },
    {
      key: "status",
      header: t("inventoryCount.columns.status"),
      render: (row: InventoryCountSummary) => (
        <InventoryCountStatusBadge status={row.status} />
      ),
    },
    {
      key: "difference",
      header: t("inventoryCount.columns.difference"),
      render: renderDifference,
    },
    {
      key: "note",
      header: t("inventoryCount.columns.note"),
      render: (row: InventoryCountSummary) =>
        row.note ? <NoteCell title={row.note}>{row.note}</NoteCell> : <Muted>—</Muted>,
    },
  ];

  const openDetail = (id: string) =>
    navigate(`/products/stock/inventarizatsiya/${id}`);

  const isEmpty = !isLoading && rows.length === 0 && !appliedSearch && status === "ALL";

  const subNav = useStockSubNav();

  return (
    <Container>
      {/* Section tabs — the mobile bar carries sections only, so a section's sibling
          pages live here. See components/layout/SubNav.tsx. */}
      <SubNav items={subNav} />
      <Title>{t("inventoryCount.title")}</Title>

      <Toolbar>
        <SearchWrapper>
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("inventoryCount.search")}
          />
          {searchQuery && (
            <ClearBtn
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={t("common.clear")}
            >
              <X size={16} />
            </ClearBtn>
          )}
        </SearchWrapper>
      </Toolbar>

      <Chips>
        {STATUS_FILTERS.map((filter) => (
          <Chip
            key={filter.value}
            type="button"
            $active={status === filter.value}
            onClick={() => {
              setPage(1);
              setStatus(filter.value);
            }}
          >
            {t(filter.labelKey)}
          </Chip>
        ))}
      </Chips>

      {isEmpty ? (
        <EmptyWrapper>
          <EmptyPlaceholder
            icon={<ClipboardCheck size={48} />}
            title={t("inventoryCount.empty")}
            description={t("inventoryCount.emptyHint")}
          />
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            {t("inventoryCount.create")}
          </Button>
        </EmptyWrapper>
      ) : (
        <>
          <MobileCardList>
            {rows.map((row) => (
              <div key={row.id} onClick={() => openDetail(row.id)}>
                <MobileCard
                  title={`#${row.number}`}
                  subtitle={row.note ?? undefined}
                  fields={[
                    {
                      label: t("inventoryCount.columns.status"),
                      value: <InventoryCountStatusBadge status={row.status} />,
                    },
                    {
                      label: t("inventoryCount.columns.employee"),
                      value: row.createdByName,
                    },
                    {
                      label: t("inventoryCount.columns.openedAt"),
                      value: formatDateTime(row.createdAt),
                    },
                    {
                      label: t("inventoryCount.columns.difference"),
                      value: renderDifference(row),
                    },
                  ]}
                />
              </div>
            ))}
          </MobileCardList>

          <DesktopOnly>
              <Table
                columns={columns}
                data={rows}
                loading={isLoading}
                emptyMessage={t("common.noResults")}
                onRowClick={(row: InventoryCountSummary) => openDetail(row.id)}
                footer={
                  <Pagination
                    currentPage={page}
                    totalPages={totalPages}
                    totalItems={total}
                    pageSize={pageSize}
                    pageSizeOptions={PAGE_SIZE_OPTIONS}
                    onPageChange={setPage}
                    onPageSizeChange={(size) => {
                      setPageSize(size);
                      setPage(1);
                    }}
                  />
                }
              />
          </DesktopOnly>
        </>
      )}

      {showCreate && (
        <CreateInventoryCountModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            openDetail(id);
          }}
        />
      )}

      <FAB
        onClick={() => setShowCreate(true)}
        title={t("inventoryCount.create")}
        aria-label={t("inventoryCount.create")}
      >
        <Plus size={38} />
      </FAB>
    </Container>
  );
}
