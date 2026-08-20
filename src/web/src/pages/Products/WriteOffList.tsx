import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { formatCurrency } from "@shared/utils";
import type { InventoryCountItem } from "../../api/client";

const List = styled.div`
  display: flex;
  flex-direction: column;
`;

/* Rows wrap instead of squeezing: on a phone the amounts drop under the name. */
const Row = styled.div<{ $selectable: boolean; $selected: boolean }>`
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: ${({ theme }) => theme.spacing.sm} 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  cursor: ${({ $selectable }) => ($selectable ? "pointer" : "default")};
  /* Deselected lines stay legible but visibly out of the write-off. */
  opacity: ${({ $selectable, $selected }) =>
    $selectable && !$selected ? 0.45 : 1};

  &:last-of-type {
    border-bottom: none;
  }
`;

const Checkbox = styled.input`
  width: 18px;
  height: 18px;
  margin-right: ${({ theme }) => theme.spacing.sm};
  flex-shrink: 0;
  align-self: center;
  cursor: pointer;
`;

const Name = styled.div`
  flex: 1 1 60%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const Barcode = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Amounts = styled.div<{ $muted: boolean }>`
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: right;
  font-size: 14px;
  font-weight: 500;
  color: ${({ theme, $muted }) =>
    $muted ? theme.colors.textSecondary : theme.colors.error};
  /* A line that will NOT be zeroed must not read as a loss. */
  text-decoration: ${({ $muted }) => ($muted ? "line-through" : "none")};
`;

const Value = styled.span`
  font-size: 12px;
  font-weight: 400;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const More = styled.div`
  padding-top: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const MoreButton = styled.button`
  width: 100%;
  min-height: 44px;
  margin-top: ${({ theme }) => theme.spacing.xs};
  border: 1px dashed ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
`;

interface WriteOffListProps {
  /** Every line eligible for write-off (uncounted and holding stock). */
  items: InventoryCountItem[];
  /** Rows to render before collapsing the tail into a "… ещё N" line. */
  limit?: number;
  /**
   * Ids currently marked for write-off. Omit to render a plain read-only list; pass it
   * together with `onToggle` to make the rows selectable.
   */
  selected?: ReadonlySet<string>;
  onToggle?: (itemId: string) => void;
  /**
   * Reveal the rows past `limit`. Required whenever the list is selectable — a line the
   * operator cannot see is a line they cannot deselect, and it would be written off
   * silently.
   */
  onShowMore?: () => void;
}

/** Per-line loss, used for both the sort order and the money column. */
function lineValue(item: InventoryCountItem): number {
  return item.cost ? Number(item.expectedQty) * Number(item.cost) : 0;
}

/**
 * The products a write-off would remove. Selectable, because "not counted" does not mean
 * "gone": stock can be in transit, booked but not unpacked, or held back for a customer,
 * and zeroing those would destroy real stock the next delivery is about to confirm.
 *
 * Shared so the pre-confirm picker and any read-only review render the same row, and so
 * the sort rule lives in one place.
 */
export function WriteOffList({
  items,
  limit = 50,
  selected,
  onToggle,
  onShowMore,
}: WriteOffListProps) {
  const { t, i18n } = useTranslation();
  const selectable = Boolean(selected && onToggle);

  // Biggest loss first — that's what a manager scans for before confirming. Lines with no
  // cost fall back to quantity so they don't all pile up at the bottom in arbitrary order.
  const sorted = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          lineValue(b) - lineValue(a) ||
          Number(b.expectedQty) - Number(a.expectedQty),
      ),
    [items],
  );

  // A full-store count can hold thousands of uncounted lines; render a slice, not all of it.
  const shown = sorted.slice(0, limit);
  const hidden = sorted.length - shown.length;

  return (
    <List>
      {shown.map((item) => {
        const isSelected = !selectable || selected!.has(item.id);
        return (
          <Row
            key={item.id}
            $selectable={selectable}
            $selected={isSelected}
            onClick={selectable ? () => onToggle!(item.id) : undefined}
          >
            {selectable && (
              <Checkbox
                type="checkbox"
                checked={isSelected}
                aria-label={item.productName}
                onChange={() => onToggle!(item.id)}
                // The row already handles the click; without this the label toggles twice.
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <Name>
              {i18n.language === "uz" ? item.productNameUz : item.productName}
              <Barcode>{item.barcode}</Barcode>
            </Name>
            <Amounts $muted={!isSelected}>
              −{Number(item.expectedQty)} {item.unit}
              {item.cost && (
                <Value>
                  −{formatCurrency(lineValue(item), i18n.language as "ru" | "uz")}
                </Value>
              )}
            </Amounts>
          </Row>
        );
      })}
      {hidden > 0 &&
        (onShowMore ? (
          <MoreButton type="button" onClick={onShowMore}>
            {t("inventoryCount.detail.writeOff.showMore", { n: hidden })}
          </MoreButton>
        ) : (
          <More>{t("inventoryCount.detail.writeOff.more", { n: hidden })}</More>
        ))}
    </List>
  );
}
