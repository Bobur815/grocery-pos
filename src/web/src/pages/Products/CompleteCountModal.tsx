import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Modal } from "@components/common/Modal";
import { Button } from "@components/common/Button";
import { formatCurrency } from "@shared/utils";
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

interface CompleteCountModalProps {
  count: InventoryCountDetail;
  /** Net difference across counted lines only, as already computed by the page. */
  netDifference: { qty: number; value: number };
  isSubmitting: boolean;
  onConfirm: (writeOffUncounted: boolean) => void;
  onClose: () => void;
}

/**
 * Completion dialog. Replaces the plain ConfirmDialog because the write-off decision
 * needs a checkbox and a numeric preview of what it will zero — ConfirmDialog only
 * takes strings.
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

  const money = (value: number) =>
    formatCurrency(value, i18n.language as "ru" | "uz");

  // Mirrors the server's selection rule exactly (inventory-count.service.ts):
  // uncounted AND expectedQty > 0. Lines already at zero are no-ops and are skipped.
  const writeOffImpact = useMemo(() => {
    const targets = count.items.filter(
      (item: InventoryCountItem) =>
        !item.counted && Number(item.expectedQty) > 0,
    );
    return targets.reduce(
      (acc, item) => {
        const qty = Number(item.expectedQty);
        acc.items += 1;
        acc.qty -= qty;
        if (item.cost) acc.value -= qty * Number(item.cost);
        return acc;
      },
      { items: 0, qty: 0, value: 0 },
    );
  }, [count.items]);

  const hasUncounted = count.totalItems > count.countedItems;
  const canWriteOff = hasUncounted && writeOffImpact.items > 0;

  // A full-store write-off zeroes everything nobody happened to scan, so it takes a
  // second, explicit acknowledgement naming the exact number of products.
  const needsAcknowledgement = writeOff && count.scope === "FULL";
  const blocked = isSubmitting || (needsAcknowledgement && !acknowledged);

  return (
    <Modal title={t("inventoryCount.detail.completeTitle")} onClose={onClose}>
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
                  n: writeOffImpact.items,
                })}
                <OptionHint>{t("inventoryCount.detail.writeOff.hint")}</OptionHint>
                <Impact $negative>
                  {t("inventoryCount.detail.writeOff.impact", {
                    qty: writeOffImpact.qty,
                    value: money(writeOffImpact.value),
                  })}
                </Impact>
              </OptionText>
            </OptionBox>

            {needsAcknowledgement && (
              <DangerBox $checked={acknowledged}>
                <Checkbox
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                <OptionText>
                  {t("inventoryCount.detail.writeOff.confirmFull", {
                    n: writeOffImpact.items,
                  })}
                </OptionText>
              </DangerBox>
            )}
          </>
        )}

        {/* Still true whenever the uncounted lines are being left alone — either because
            there is nothing to write off, or because the box is unticked. */}
        {hasUncounted && !writeOff && (
          <Note>{t("inventoryCount.detail.uncountedWarning")}</Note>
        )}

        <Actions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant={writeOff ? "danger" : "primary"}
            disabled={blocked}
            onClick={() => onConfirm(writeOff)}
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
