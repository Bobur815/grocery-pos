import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import styled from "styled-components";
import { ArrowLeft, Camera, Minus, Plus } from "lucide-react";
import { Table } from "@components/common/Table";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import { ConfirmDialog } from "@components/common/ConfirmDialog";
import { Spinner } from "@components/common/Spinner";
import { useToast } from "@context/ToastContext";
import { formatCurrency } from "@shared/utils";
import { formatDateTime } from "../../utils/formatters";
import {
  MobileCardList,
  DesktopOnly,
} from "../../components/common/MobileCard";
import { BarcodeScannerModal } from "../../components/common/BarcodeScannerModal";
import { InventoryCountStatusBadge } from "./InventoryCountStatusBadge";
import { CompleteCountModal } from "./CompleteCountModal";
import { ScanQuantityModal } from "./ScanQuantityModal";
import {
  inventoryCounts,
  type InventoryCountDetail as CountDetail,
  type InventoryCountItem,
  type InventoryCountProgress,
} from "../../api/client";

const MOBILE_PAGE_SIZE = 20;

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

/* Sticky so "Yakunlash" is always reachable while walking the aisles. */
const Header = styled.div`
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  background-color: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const HeaderInfo = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  flex-wrap: wrap;
`;

const DocNumber = styled.h1`
  margin: 0;
  font-size: 20px;
  color: ${({ theme }) => theme.colors.text};
`;

const Meta = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const HeaderActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};

  @media (max-width: 640px) {
    width: 100%;
    > * {
      flex: 1;
    }
  }
`;

const ScanRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
`;

const Filters = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
  flex-wrap: wrap;
`;

const Toggle = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  white-space: nowrap;
`;

const Banner = styled.div`
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.info}20;
  color: ${({ theme }) => theme.colors.info};
  font-size: 13px;
`;

const Stepper = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const StepButton = styled.button`
  min-width: 44px;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`;

const QtyInput = styled.input`
  width: 90px;
  min-height: 44px;
  text-align: center;
  font-size: 16px;
  padding: ${({ theme }) => theme.spacing.xs};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};

  /* Hide the native number spinners — the -/+ steppers beside the field are the
     control, and the tiny built-in arrows are both redundant and hard to hit. */
  appearance: textfield;
  -moz-appearance: textfield;

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  &:disabled {
    opacity: 0.6;
  }
`;

const Diff = styled.span<{ $negative: boolean }>`
  color: ${({ theme, $negative }) =>
    $negative ? theme.colors.error : theme.colors.success};
  font-weight: 500;
`;

const Muted = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

/* Marks a line zeroed by a write-off, so it doesn't read as "someone counted zero". */
const WrittenOffPill = styled.span`
  display: inline-block;
  margin-left: ${({ theme }) => theme.spacing.xs};
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  background-color: ${({ theme }) => theme.colors.warning};
  color: #fff;
`;

const ItemCard = styled.div<{ $highlight: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme, $highlight }) =>
    $highlight ? `${theme.colors.success}20` : theme.colors.surface};
  transition: background-color 0.4s ease;
`;

const CardTitle = styled.div`
  font-weight: 600;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
`;

const CardRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const HighlightRow = styled.span<{ $highlight: boolean }>`
  display: block;
  background-color: ${({ theme, $highlight }) =>
    $highlight ? `${theme.colors.success}30` : "transparent"};
  transition: background-color 0.4s ease;
`;

const Sentinel = styled.div`
  height: 1px;

  @media (min-width: 769px) {
    display: none;
  }
`;

const Centered = styled.div`
  display: flex;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.xl};
`;

const SummaryBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.lg};
  flex-wrap: wrap;
  padding: ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const SummaryItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};

  strong {
    font-size: 16px;
    color: ${({ theme }) => theme.colors.text};
  }
`;

/** Live difference for a line the user is still editing. */
function lineDifference(item: InventoryCountItem): number | null {
  if (item.countedQty === null) return null;
  return Number(item.countedQty) - Number(item.expectedQty);
}

export function InventoryCountDetail() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();

  const [count, setCount] = useState<CountDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [barcode, setBarcode] = useState("");
  const [blindCount, setBlindCount] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [onlyUncounted, setOnlyUncounted] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [scannedItem, setScannedItem] = useState<InventoryCountItem | null>(null);
  const [isSavingScan, setIsSavingScan] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mobileCount, setMobileCount] = useState(MOBILE_PAGE_SIZE);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const highlightTimer = useRef<number>();

  const isClosed =
    count?.status === "COMPLETED" || count?.status === "CANCELLED";
  const isReadOnly = isClosed;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const data = await inventoryCounts.get(id);
        if (!cancelled) setCount(data);
      } catch {
        if (!cancelled) toast.error(t("inventoryCount.detail.loadError"));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  /** Merge a single-line response back into the document without refetching everything. */
  const applyProgress = useCallback((progress: InventoryCountProgress) => {
    setCount((prev) =>
      prev
        ? {
            ...prev,
            status: progress.status,
            countedItems: progress.countedItems,
            items: prev.items.map((i) =>
              i.id === progress.item.id ? progress.item : i,
            ),
          }
        : prev,
    );
    setHighlightId(progress.item.id);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), 900);
  }, []);

  const handleScan = useCallback(
    async (scanned: string) => {
      const value = scanned.trim();
      if (!id || !value || isReadOnly) return;
      try {
        applyProgress(await inventoryCounts.scan(id, value, 1));
      } catch {
        toast.error(t("inventoryCount.detail.notInList"));
      } finally {
        setBarcode("");
        barcodeRef.current?.focus();
      }
    },
    [id, isReadOnly, applyProgress, toast, t],
  );

  /** Returns false when the save failed, so callers can keep their input open. */
  const setItemQty = useCallback(
    async (item: InventoryCountItem, qty: number): Promise<boolean> => {
      if (!id || isReadOnly) return false;
      const next = Number.isFinite(qty) ? Math.max(0, qty) : 0;
      try {
        applyProgress(await inventoryCounts.setItem(id, item.id, next));
        return true;
      } catch {
        toast.error(t("inventoryCount.detail.saveError"));
        return false;
      }
    },
    [id, isReadOnly, applyProgress, toast, t],
  );

  /**
   * Camera scans open a quantity prompt instead of applying +1. A handheld scanner fires
   * repeatedly and +1 per shot is the fast aisle flow; a camera scan is one deliberate
   * act, so the counter should say how many they actually see.
   */
  const handleCameraScan = useCallback(
    (scanned: string) => {
      const value = scanned.trim();
      if (!count || !value || isReadOnly) return;
      const item = count.items.find((i) => i.barcode === value);
      if (!item) {
        toast.error(t("inventoryCount.detail.notInList"));
        return;
      }
      setScannedItem(item);
    },
    [count, isReadOnly, toast, t],
  );

  const handleScannedQty = useCallback(
    async (qty: number) => {
      if (!scannedItem) return;
      setIsSavingScan(true);
      try {
        // Keep the modal open on failure so the typed quantity isn't lost.
        if (await setItemQty(scannedItem, qty)) setScannedItem(null);
      } finally {
        setIsSavingScan(false);
      }
    },
    [scannedItem, setItemQty],
  );

  const visibleItems = useMemo(() => {
    if (!count) return [];
    const query = itemSearch.trim().toLowerCase();
    return count.items.filter((item) => {
      if (onlyUncounted && item.counted) return false;
      if (!query) return true;
      return (
        item.productName.toLowerCase().includes(query) ||
        item.productNameUz.toLowerCase().includes(query) ||
        item.barcode.includes(query)
      );
    });
  }, [count, itemSearch, onlyUncounted]);

  useEffect(() => {
    setMobileCount(MOBILE_PAGE_SIZE);
  }, [itemSearch, onlyUncounted]);

  // Infinite scroll on mobile — a full-store count can be thousands of lines.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && mobileCount < visibleItems.length) {
          setMobileCount((c) =>
            Math.min(c + MOBILE_PAGE_SIZE, visibleItems.length),
          );
        }
      },
      { rootMargin: "150px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mobileCount, visibleItems.length]);

  const productLabel = (item: InventoryCountItem) =>
    i18n.language === "uz" ? item.productNameUz : item.productName;

  const netDifference = useMemo(() => {
    if (!count) return { qty: 0, value: 0 };
    return count.items.reduce(
      (acc, item) => {
        const diff = lineDifference(item);
        if (diff === null || !item.counted) return acc;
        acc.qty += diff;
        if (item.cost) acc.value += diff * Number(item.cost);
        return acc;
      },
      { qty: 0, value: 0 },
    );
  }, [count]);

  const handleComplete = async (writeOffUncounted: boolean) => {
    if (!id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await inventoryCounts.complete(id, { writeOffUncounted });
      toast.success(
        t(
          writeOffUncounted
            ? "inventoryCount.detail.writeOff.done"
            : "inventoryCount.detail.completed",
        ),
      );
      setShowComplete(false);
      setCount(await inventoryCounts.get(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!id || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await inventoryCounts.cancel(id);
      toast.success(t("inventoryCount.detail.cancelled"));
      setShowCancel(false);
      setCount(await inventoryCounts.get(id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderCountedCell = (item: InventoryCountItem) => (
    <Stepper>
      <StepButton
        type="button"
        disabled={isReadOnly}
        aria-label="-1"
        onClick={() => setItemQty(item, Number(item.countedQty ?? 0) - 1)}
      >
        <Minus size={16} />
      </StepButton>
      <QtyInput
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        disabled={isReadOnly}
        defaultValue={item.countedQty ?? ""}
        key={`${item.id}-${item.countedQty ?? "empty"}`}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") return;
          const next = Number(raw);
          // `null` means "not counted yet", which is NOT the same as a counted 0 —
          // only skip the request when the line already holds this exact value.
          if (item.countedQty !== null && next === Number(item.countedQty))
            return;
          setItemQty(item, next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <StepButton
        type="button"
        disabled={isReadOnly}
        aria-label="+1"
        onClick={() => setItemQty(item, Number(item.countedQty ?? 0) + 1)}
      >
        <Plus size={16} />
      </StepButton>
    </Stepper>
  );

  const renderDiffCell = (item: InventoryCountItem) => {
    const diff = lineDifference(item);
    if (diff === null) return <Muted>—</Muted>;
    return (
      <Diff $negative={diff < 0}>
        {diff > 0 ? "+" : ""}
        {diff}
      </Diff>
    );
  };

  const columns = [
    {
      key: "productName",
      header: t("inventoryCount.detail.product"),
      render: (item: InventoryCountItem) => (
        <HighlightRow $highlight={highlightId === item.id}>
          {productLabel(item)}
          {item.writtenOff && (
            <WrittenOffPill>
              {t("inventoryCount.detail.writeOff.badge")}
            </WrittenOffPill>
          )}
          <br />
          <Muted style={{ fontSize: 12 }}>{item.barcode}</Muted>
        </HighlightRow>
      ),
    },
    ...(blindCount
      ? []
      : [
          {
            key: "expectedQty",
            header: t("inventoryCount.detail.expected"),
            render: (item: InventoryCountItem) =>
              `${Number(item.expectedQty)} ${item.unit}`,
          },
        ]),
    {
      key: "countedQty",
      header: t("inventoryCount.detail.counted"),
      render: renderCountedCell,
    },
    ...(blindCount
      ? []
      : [
          {
            key: "difference",
            header: t("inventoryCount.detail.difference"),
            render: renderDiffCell,
          },
        ]),
  ];

  if (isLoading) {
    return (
      <Centered>
        <Spinner size={32} />
      </Centered>
    );
  }

  if (!count) {
    return (
      <Container>
        <Button
          variant="secondary"
          size="small"
          onClick={() => navigate("/products/stock/inventarizatsiya")}
          tooltip={t("inventoryCount.detail.back")}
        >
          <ArrowLeft size={20} />
        </Button>
        <Muted>{t("inventoryCount.detail.loadError")}</Muted>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Button
          variant="secondary"
          size="small"
          onClick={() => navigate("/products/stock/inventarizatsiya")}
          tooltip={t("inventoryCount.detail.back")}
        >
          <ArrowLeft size={20} />
        </Button>
        <HeaderInfo>
          <DocNumber>#{count.number}</DocNumber>
          <InventoryCountStatusBadge status={count.status} />
          <Meta>{count.createdByName}</Meta>
          <Meta>
            {t("inventoryCount.detail.progress", {
              counted: count.countedItems,
              total: count.totalItems,
            })}
          </Meta>
        </HeaderInfo>

        {!isClosed && (
          <HeaderActions>
            <Button variant="secondary" onClick={() => setShowCancel(true)}>
              {t("inventoryCount.detail.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => setShowComplete(true)}
              disabled={count.countedItems === 0}
            >
              {t("inventoryCount.detail.complete")}
            </Button>
          </HeaderActions>
        )}
      </Header>

      {isClosed && (
        <SummaryBar>
          <SummaryItem>
            {t("inventoryCount.columns.status")}
            <strong>
              {count.status === "COMPLETED"
                ? t("inventoryCount.status.completed")
                : t("inventoryCount.status.cancelled")}
            </strong>
          </SummaryItem>
          <SummaryItem>
            {t("inventoryCount.detail.counted")}
            <strong>
              {count.countedItems} / {count.totalItems}
            </strong>
          </SummaryItem>
          <SummaryItem>
            {t("inventoryCount.detail.difference")}
            <strong>
              {Number(count.totalDifference) > 0 ? "+" : ""}
              {Number(count.totalDifference)} ·{" "}
              {formatCurrency(
                Number(count.totalValueDiff),
                i18n.language as "ru" | "uz",
              )}
            </strong>
          </SummaryItem>
          {count.wroteOffUncounted && (
            <SummaryItem>
              {t("inventoryCount.detail.writeOff.summary")}
              <strong>
                {count.writtenOffItems} ·{" "}
                {formatCurrency(
                  Number(count.writeOffValue),
                  i18n.language as "ru" | "uz",
                )}
              </strong>
            </SummaryItem>
          )}
          {count.completedAt && (
            <SummaryItem>
              {t("inventoryCount.columns.closedAt")}
              <strong>{formatDateTime(count.completedAt)}</strong>
            </SummaryItem>
          )}
        </SummaryBar>
      )}

      {isReadOnly ? (
        <Banner>{t("inventoryCount.detail.readOnly")}</Banner>
      ) : (
        <ScanRow>
          <Input
            ref={barcodeRef}
            autoFocus
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleScan(barcode);
            }}
            placeholder={t("inventoryCount.detail.scan")}
            style={{ paddingRight: "32px", fontSize: 18, fontWeight: "bold" }}
          />
          <IconButton
            type="button"
            onClick={() => setShowScanner(true)}
            title={t("inventoryCount.detail.scanCamera")}
            aria-label={t("inventoryCount.detail.scanCamera")}
          >
            <Camera size={20} />
          </IconButton>
        </ScanRow>
      )}

      <Filters>
        <Input
          value={itemSearch}
          onChange={(e) => setItemSearch(e.target.value)}
          placeholder={t("inventoryCount.detail.searchItems")}
          style={{ paddingRight: "32px", fontSize: 18, fontWeight: "bold" }}
        />
        <Toggle>
          <input
            type="checkbox"
            checked={onlyUncounted}
            onChange={(e) => setOnlyUncounted(e.target.checked)}
          />
          {t("inventoryCount.detail.onlyUncounted")}
        </Toggle>
        <Toggle title={t("inventoryCount.detail.blindCountHint")}>
          <input
            type="checkbox"
            checked={blindCount}
            onChange={(e) => setBlindCount(e.target.checked)}
          />
          {t("inventoryCount.detail.blindCount")}
        </Toggle>
      </Filters>

      <MobileCardList>
        {visibleItems.slice(0, mobileCount).map((item) => (
          <ItemCard key={item.id} $highlight={highlightId === item.id}>
            <CardTitle>
              {productLabel(item)}
              {item.writtenOff && (
                <WrittenOffPill>
                  {t("inventoryCount.detail.writeOff.badge")}
                </WrittenOffPill>
              )}
            </CardTitle>
            <Muted style={{ fontSize: 12 }}>{item.barcode}</Muted>
            {!blindCount && (
              <CardRow>
                <Muted>{t("inventoryCount.detail.expected")}</Muted>
                <span>
                  {Number(item.expectedQty)} {item.unit}
                </span>
              </CardRow>
            )}
            <CardRow>
              <Muted>{t("inventoryCount.detail.counted")}</Muted>
              {renderCountedCell(item)}
            </CardRow>
            {!blindCount && (
              <CardRow>
                <Muted>{t("inventoryCount.detail.difference")}</Muted>
                {renderDiffCell(item)}
              </CardRow>
            )}
          </ItemCard>
        ))}
        <Sentinel ref={sentinelRef} />
      </MobileCardList>

      <DesktopOnly>
        <Table
          columns={columns}
          data={visibleItems}
          emptyMessage={t("inventoryCount.detail.noItems")}
        />
      </DesktopOnly>

      {showScanner && (
        <BarcodeScannerModal
          title={t("inventoryCount.detail.scanCamera")}
          onScan={(value) => {
            setShowScanner(false);
            handleCameraScan(value);
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {scannedItem && (
        <ScanQuantityModal
          item={scannedItem}
          blindCount={blindCount}
          isSaving={isSavingScan}
          onSave={handleScannedQty}
          onClose={() => setScannedItem(null)}
        />
      )}

      {showComplete && (
        <CompleteCountModal
          count={count}
          netDifference={netDifference}
          isSubmitting={isSubmitting}
          onConfirm={handleComplete}
          onClose={() => setShowComplete(false)}
        />
      )}

      {showCancel && (
        <ConfirmDialog
          title={t("inventoryCount.detail.cancel")}
          message={t("inventoryCount.detail.cancelConfirm")}
          confirmLabel={t("inventoryCount.detail.cancel")}
          cancelLabel={t("common.close")}
          variant="danger"
          isLoading={isSubmitting}
          onConfirm={handleCancel}
          onCancel={() => setShowCancel(false)}
        />
      )}
    </Container>
  );
}
