import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Minus, Plus } from "lucide-react";
import { Modal } from "@components/common/Modal";
import { Button } from "@components/common/Button";
import type { InventoryCountItem } from "../../api/client";

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

/* Same visual language as the item cards on the counting screen. */
const Card = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.background};
`;

const ProductName = styled.div`
  font-weight: 600;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.text};
`;

const Barcode = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const CardRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spacing.sm};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};

  strong {
    color: ${({ theme }) => theme.colors.text};
  }
`;

const Stepper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const StepButton = styled.button`
  min-width: 52px;
  min-height: 52px;
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
  width: 120px;
  min-height: 52px;
  text-align: center;
  font-size: 22px;
  font-weight: 600;
  padding: ${({ theme }) => theme.spacing.xs};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};

  /* The steppers are the control — the native arrows are redundant and hard to hit. */
  appearance: textfield;
  -moz-appearance: textfield;

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
`;

const Unit = styled.span`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  justify-content: flex-end;

  @media (max-width: 640px) {
    flex-direction: column-reverse;
  }
`;

interface ScanQuantityModalProps {
  item: InventoryCountItem;
  /** Hide the expected quantity so the counter isn't anchored to the system number. */
  blindCount: boolean;
  isSaving: boolean;
  onSave: (qty: number) => void;
  onClose: () => void;
}

/**
 * Opened after a CAMERA scan so the counter can type how many they actually see,
 * rather than the +1 the handheld-scanner flow applies. The quantity is absolute:
 * it replaces whatever the line holds, and is pre-filled with the current value so
 * re-scanning a line shows what is already recorded.
 */
export function ScanQuantityModal({
  item,
  blindCount,
  isSaving,
  onSave,
  onClose,
}: ScanQuantityModalProps) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(
    item.countedQty === null ? "" : String(Number(item.countedQty)),
  );

  const productName =
    i18n.language === "uz" ? item.productNameUz : item.productName;

  useEffect(() => {
    // Select rather than just focus, so typing replaces the pre-filled value.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const parsed = Number(value);
  const isValid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  const step = (delta: number) => {
    const base = value.trim() === "" ? 0 : Number(value);
    const next = Math.max(0, (Number.isFinite(base) ? base : 0) + delta);
    setValue(String(next));
  };

  const submit = () => {
    if (!isValid || isSaving) return;
    onSave(parsed);
  };

  return (
    <Modal title={t("inventoryCount.detail.scanQty.title")} onClose={onClose}>
      <Body>
        <Card>
          <ProductName>{productName}</ProductName>
          <Barcode>{item.barcode}</Barcode>
          {!blindCount && (
            <CardRow>
              <span>{t("inventoryCount.detail.expected")}</span>
              <strong>
                {Number(item.expectedQty)} {item.unit}
              </strong>
            </CardRow>
          )}
          <CardRow>
            <span>{t("inventoryCount.detail.scanQty.currentlyCounted")}</span>
            <strong>
              {item.countedQty === null
                ? t("inventoryCount.detail.scanQty.notCountedYet")
                : `${Number(item.countedQty)} ${item.unit}`}
            </strong>
          </CardRow>
        </Card>

        <Stepper>
          <StepButton
            type="button"
            aria-label="-1"
            disabled={isSaving}
            onClick={() => step(-1)}
          >
            <Minus size={20} />
          </StepButton>
          <QtyInput
            ref={inputRef}
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            disabled={isSaving}
            value={value}
            placeholder={t("inventoryCount.detail.scanQty.enterQty")}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
          />
          <StepButton
            type="button"
            aria-label="+1"
            disabled={isSaving}
            onClick={() => step(1)}
          >
            <Plus size={20} />
          </StepButton>
        </Stepper>
        <Unit style={{ textAlign: "center" }}>{item.unit}</Unit>

        <Actions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!isValid || isSaving}
            onClick={submit}
          >
            {isSaving ? t("common.saving") : t("common.save")}
          </Button>
        </Actions>
      </Body>
    </Modal>
  );
}
