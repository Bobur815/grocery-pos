import React, { useCallback, useEffect, useRef } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { Box, Package, X } from "lucide-react";
import { Product } from "@shared/types";
import { boxUnitPrice } from "@shared/utils";
import { formatCurrency } from "../utils/formatters";

interface SaleUnitModalProps {
  product: Product;
  /** Quantity the cashier already typed, interpreted in whichever unit they pick. */
  quantity: number;
  onSelect: (unit: "piece" | "box") => void;
  onCancel: () => void;
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.md};
  padding: ${({ theme }) => theme.spacing.lg};
  width: 520px;
  max-width: 95vw;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  &:hover {
    background: ${({ theme }) => theme.colors.background};
  }
`;

const ProductInfo = styled.div`
  background: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
`;

const ProductName = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
  margin-bottom: ${({ theme }) => theme.spacing.xs};
`;

const ProductMeta = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Choices = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Choice = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  border: 2px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: ${({ theme }) => theme.colors.primary};
    background: ${({ theme }) => theme.colors.primary}12;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const ChoiceKey = styled.span`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ChoiceLabel = styled.span`
  font-size: 16px;
  font-weight: 600;
`;

const ChoicePrice = styled.span`
  font-size: 22px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  font-variant-numeric: tabular-nums;
`;

const ChoiceHint = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
`;

// Parks focus somewhere harmless. A cashier may scan the next product while this modal is
// open; that burst — digits and a trailing Enter — lands in here and is thrown away with the
// modal, instead of "clicking" whichever choice button held focus. Same trick BulkWeighModal
// uses to catch scale output.
const ScanSink = styled.input`
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
`;

export function SaleUnitModal({
  product,
  quantity,
  onSelect,
  onCancel,
}: SaleUnitModalProps) {
  const { t, i18n } = useTranslation();
  const sinkRef = useRef<HTMLInputElement>(null);

  const productName = i18n.language === "uz" ? product.nameUz : product.nameRu;
  const piecesPerBox = product.piecesPerBox || 1;
  const piecePrice = Number(product.price);
  const boxPrice = boxUnitPrice(product);

  // Stock is counted in pieces, so a box needs piecesPerBox of them per unit sold.
  const piecesNeeded = piecesPerBox * quantity;
  const boxAvailable = product.stock >= piecesNeeded;
  const pieceAvailable = product.stock >= quantity;

  useEffect(() => {
    sinkRef.current?.focus();
  }, []);

  // F1 / F2 pick a unit, Escape cancels. Deliberately NOT the bare digits 1 and 2: a barcode
  // scanner emits digits, so a stray scan while this modal is open would silently choose a
  // unit and put the wrong money in the cart. Scanners cannot emit function keys.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "F1" && pieceAvailable) {
        e.preventDefault();
        onSelect("piece");
      } else if (e.key === "F2" && boxAvailable) {
        e.preventDefault();
        onSelect("box");
      }
    },
    [onCancel, onSelect, pieceAvailable, boxAvailable],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <Overlay
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <Modal>
        <Header>
          <Title>
            <Package size={20} />
            {t("saleUnit.title", "Как продать?")}
          </Title>
          <CloseButton onClick={onCancel} tabIndex={-1}>
            <X size={18} />
          </CloseButton>
        </Header>

        <ProductInfo>
          <ProductName>{productName}</ProductName>
          <ProductMeta>
            <span>
              {t("saleUnit.inStock", "На складе")}: {product.stock}{" "}
              {t("saleUnit.pcs", "шт")}
            </span>
            {quantity !== 1 && (
              <span>
                {t("saleUnit.quantity", "Количество")}: {quantity}
              </span>
            )}
          </ProductMeta>
        </ProductInfo>

        {/* Absorbs any barcode scanned while the modal is open — see ScanSink. */}
        <ScanSink ref={sinkRef} tabIndex={-1} readOnly />

        <Choices>
          <Choice
            type="button"
            tabIndex={-1}
            onClick={() => onSelect("piece")}
            disabled={!pieceAvailable}
          >
            <Package size={22} />
            <ChoiceKey>F1</ChoiceKey>
            <ChoiceLabel>{t("saleUnit.piece", "Штука")}</ChoiceLabel>
            <ChoicePrice>{formatCurrency(piecePrice)}</ChoicePrice>
            <ChoiceHint>
              {quantity !== 1
                ? `${quantity} ${t("saleUnit.pcs", "шт")} = ${formatCurrency(piecePrice * quantity)}`
                : t("saleUnit.pieceHint", "1 шт со склада")}
            </ChoiceHint>
          </Choice>

          <Choice
            type="button"
            tabIndex={-1}
            onClick={() => onSelect("box")}
            disabled={!boxAvailable}
          >
            <Box size={22} />
            <ChoiceKey>F2</ChoiceKey>
            <ChoiceLabel>
              {t("saleUnit.box", "Коробка")} ({piecesPerBox}{" "}
              {t("saleUnit.pcs", "шт")})
            </ChoiceLabel>
            <ChoicePrice>{formatCurrency(boxPrice)}</ChoicePrice>
            <ChoiceHint>
              {boxAvailable
                ? `−${piecesNeeded} ${t("saleUnit.pcs", "шт")}${quantity !== 1 ? ` = ${formatCurrency(boxPrice * quantity)}` : ""}`
                : t("saleUnit.notEnoughForBox", "Недостаточно на складе")}
            </ChoiceHint>
          </Choice>
        </Choices>
      </Modal>
    </Overlay>
  );
}

export default SaleUnitModal;
