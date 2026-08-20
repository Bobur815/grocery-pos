import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Modal } from "@components/common/Modal";
import { Button } from "@components/common/Button";
import { formatCurrency } from "@shared/utils";
import { WriteOffList } from "./WriteOffList";
import type {
  InventoryCountDetail,
  InventoryCountItem,
} from "../../api/client";

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Summary = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

const Note = styled.p`
  margin: 0;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
`;

const OptionBox = styled.label<{ $checked: boolean }>`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: flex-start;
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 1px solid
    ${({ theme, $checked }) => ($checked ? theme.colors.warning : theme.colors.border)};
  background-color: ${({ theme, $checked }) =>
    $checked ? `${theme.colors.warning}14` : "transparent"};
  cursor: pointer;
`;

const OptionText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const OptionHint = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Impact = styled.span<{ $negative: boolean }>`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme, $negative }) =>
    $negative ? theme.colors.error : theme.colors.text};
`;

/* Sits outside the OptionBox label — inside it, every click would toggle the checkbox. */
const Disclosure = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  align-self: flex-start;
  min-height: 44px;
  padding: 0;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
`;

/* Scrolls internally so the modal never outgrows its 90vh and buries the buttons. */
const ListPanel = styled.div`
  max-height: 260px;
  overflow-y: auto;
  padding: 0 ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.background};
`;

/* The whole-store case gets its own visual weight — this one can't be undone. */
const DangerBox = styled(OptionBox)`
  border-color: ${({ theme }) => theme.colors.error};
  background-color: ${({ theme }) => theme.colors.error}14;
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  justify-content: flex-end;

  @media (max-width: 640px) {
    flex-direction: column-reverse;
  }
`;

const Checkbox = styled.input`
  width: 18px;
  height: 18px;
  margin-top: 1px;
  flex-shrink: 0;
`;

const PickerBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
  flex-wrap: wrap;
`;

const SearchInput = styled.input`
  flex: 1 1 180px;
  min-width: 0;
  min-height: 44px;
  padding: 0 ${({ theme }) => theme.spacing.sm};
  font-size: 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
`;

const BulkButton = styled.button`
  min-height: 44px;
  padding: 0 ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  white-space: nowrap;
`;

/** Rows rendered per page of the picker; "show more" adds another page. */
const ROW_LIMIT = 50;

interface CompleteCountModalProps {
  count: InventoryCountDetail;
  /** Net difference across counted lines only, as already computed by the page. */
  netDifference: { qty: number; value: number };
  isSubmitting: boolean;
  /**
   * Ids of the uncounted lines to zero. Empty means "complete without writing anything
   * off" — the caller sends the list verbatim, so the server never has to re-derive it.
   */
  onConfirm: (writeOffItemIds: string[]) => void;
  onClose: () => void;
}

/**
 * Completion dialog. Replaces the plain ConfirmDialog because the write-off decision
 * needs a checkbox, a picker and a numeric preview of what it will zero — ConfirmDialog
 * only takes strings.
 */
export function CompleteCountModal({
  count,
  netDifference,
  isSubmitting,
  onConfirm,
  onClose,
}: CompleteCountModalProps) {
  const { t, i18n } = useTranslation();
  const [writeOff, setWriteOff] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [showList, setShowList] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(ROW_LIMIT);
  /**
   * Item ids that will actually be zeroed. `null` means "not narrowed yet" and behaves as
   * every eligible line — so ticking the box and confirming still writes off everything,
   * exactly as before. It only becomes a real set once the operator deselects something.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);

  const money = (value: number) =>
    formatCurrency(value, i18n.language as "ru" | "uz");

  // Mirrors the server's eligibility rule exactly (inventory-count.service.ts):
  // uncounted AND expectedQty > 0. Lines already at zero are no-ops and are skipped.
  const eligible = useMemo(
    () =>
      count.items.filter(
        (item: InventoryCountItem) =>
          !item.counted && Number(item.expectedQty) > 0,
      ),
    [count.items],
  );

  /** The lines that will actually be written off, given the current selection. */
  const selectedItems = useMemo(
    () => (picked ? eligible.filter((i) => picked.has(i.id)) : eligible),
    [eligible, picked],
  );

  // Totals come from the same array the list renders, so the preview and the numbers can
  // never disagree — and both follow the selection.
  const impact = useMemo(
    () =>
      selectedItems.reduce(
        (acc, item) => {
          const qty = Number(item.expectedQty);
          acc.qty -= qty;
          if (item.cost) acc.value -= qty * Number(item.cost);
          return acc;
        },
        { qty: 0, value: 0 },
      ),
    [selectedItems],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return eligible;
    return eligible.filter(
      (i) =>
        i.productName.toLowerCase().includes(query) ||
        i.productNameUz.toLowerCase().includes(query) ||
        i.barcode.includes(query),
    );
  }, [eligible, search]);

  /** First toggle materialises the implicit "all" into a real set, then removes one. */
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev ?? eligible.map((i) => i.id));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = useMemo(
    () => new Set(selectedItems.map((i) => i.id)),
    [selectedItems],
  );

  const setAll = (on: boolean) =>
    setPicked(on ? new Set(eligible.map((i) => i.id)) : new Set());

  const hasUncounted = count.totalItems > count.countedItems;
  const canWriteOff = hasUncounted && eligible.length > 0;
  // Deselecting every line means "write nothing off" — the confirm button must not claim
  // otherwise, and the server would refuse to act on an empty selection anyway.
  const writingOff = writeOff && selectedItems.length > 0;

  // A full-store write-off zeroes everything nobody happened to scan, so it takes a
  // second, explicit acknowledgement naming the exact number of products.
  const needsAcknowledgement = writingOff && count.scope === "FULL";
  const blocked = isSubmitting || (needsAcknowledgement && !acknowledged);

  return (
    <Modal
      title={t("inventoryCount.detail.completeTitle")}
      onClose={onClose}
      width="560px"
    >
      <Body>
        <Summary>
          {t("inventoryCount.detail.completeSummary", {
            counted: count.countedItems,
            total: count.totalItems,
            difference: `${netDifference.qty > 0 ? "+" : ""}${netDifference.qty}`,
            value: money(netDifference.value),
          })}
        </Summary>

        {canWriteOff && (
          <>
            <OptionBox $checked={writeOff}>
              <Checkbox
                type="checkbox"
                checked={writeOff}
                onChange={(e) => {
                  setWriteOff(e.target.checked);
                  if (!e.target.checked) setAcknowledged(false);
                }}
              />
              <OptionText>
                {t("inventoryCount.detail.writeOff.label", {
                  n: selectedItems.length,
                })}
                <OptionHint>{t("inventoryCount.detail.writeOff.hint")}</OptionHint>
                <Impact $negative>
                  {t("inventoryCount.detail.writeOff.impact", {
                    qty: impact.qty,
                    value: money(impact.value),
                  })}
                </Impact>
              </OptionText>
            </OptionBox>

            <Disclosure
              type="button"
              aria-expanded={showList}
              onClick={() => setShowList((v) => !v)}
            >
              {showList ? (
                <ChevronDown size={16} />
              ) : (
                <ChevronRight size={16} />
              )}
              {showList
                ? t("inventoryCount.detail.writeOff.hideList")
                : t("inventoryCount.detail.writeOff.choose", {
                    selected: selectedItems.length,
                    total: eligible.length,
                  })}
            </Disclosure>

            {showList && (
              <>
                <PickerBar>
                  {/* Search matters here: without it, a line past the row cap could not be
                      reached to deselect, and would be zeroed unnoticed. */}
                  <SearchInput
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setLimit(ROW_LIMIT);
                    }}
                    placeholder={t("inventoryCount.detail.searchItems")}
                  />
                  <BulkButton type="button" onClick={() => setAll(true)}>
                    {t("inventoryCount.detail.writeOff.selectAll")}
                  </BulkButton>
                  <BulkButton type="button" onClick={() => setAll(false)}>
                    {t("inventoryCount.detail.writeOff.clearAll")}
                  </BulkButton>
                </PickerBar>

                <ListPanel>
                  {visible.length === 0 ? (
                    <Note>{t("inventoryCount.detail.noItems")}</Note>
                  ) : (
                    <WriteOffList
                      items={visible}
                      limit={limit}
                      selected={selectedIds}
                      onToggle={toggle}
                      onShowMore={() => setLimit((n) => n + ROW_LIMIT)}
                    />
                  )}
                </ListPanel>

                {/* The lines being KEPT are the whole point of picking, so say how many. */}
                {selectedItems.length < eligible.length && (
                  <Note>
                    {t("inventoryCount.detail.writeOff.keeping", {
                      n: eligible.length - selectedItems.length,
                    })}
                  </Note>
                )}
              </>
            )}

            {needsAcknowledgement && (
              <DangerBox $checked={acknowledged}>
                <Checkbox
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <OptionText>
                  {t("inventoryCount.detail.writeOff.confirmFull", {
                    n: selectedItems.length,
                  })}
                </OptionText>
              </DangerBox>
            )}
          </>
        )}

        {/* Still true whenever the uncounted lines are being left alone — either because
            there is nothing to write off, or because the box is unticked. */}
        {hasUncounted && !writingOff && (
          <Note>{t("inventoryCount.detail.uncountedWarning")}</Note>
        )}

        <Actions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant={writingOff ? "danger" : "primary"}
            disabled={blocked}
            onClick={() =>
              onConfirm(writingOff ? selectedItems.map((i) => i.id) : [])
            }
          >
            {isSubmitting
              ? t("common.processing")
              : t("inventoryCount.detail.complete")}
          </Button>
        </Actions>
      </Body>
    </Modal>
  );
}
