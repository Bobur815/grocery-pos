import React, { useState, useEffect, useRef, useCallback } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { X, Scale, Printer, ShoppingCart } from "lucide-react";
import { Product } from "@shared/types";
import { useToast } from "../context/ToastContext";

interface BulkWeighModalProps {
  product: Product;
  onAddToCart: (weight: number) => void;
  onPrintAndScan: (weighedItemId: string, barcode: string) => void;
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
  width: 480px;
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

const WeightDisplay = styled.div<{ $status: "zero" | "valid" | "invalid" }>`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme, $status }) =>
    $status === "valid"
      ? theme.colors.success + "15"
      : $status === "invalid"
        ? theme.colors.error + "15"
        : theme.colors.background};
  border: 2px solid
    ${({ theme, $status }) =>
      $status === "valid"
        ? theme.colors.success
        : $status === "invalid"
          ? theme.colors.error
          : theme.colors.border};
  transition: all 0.2s;
`;

const WeightValue = styled.div<{ $status: "zero" | "valid" | "invalid" }>`
  font-size: 48px;
  font-weight: bold;
  color: ${({ theme, $status }) =>
    $status === "valid"
      ? theme.colors.success
      : $status === "invalid"
        ? theme.colors.error
        : theme.colors.textSecondary};
  line-height: 1;
  font-variant-numeric: tabular-nums;
`;

const WeightUnit = styled.span`
  font-size: 20px;
  font-weight: normal;
  margin-left: 4px;
`;

const WeightHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const TotalPrice = styled.div`
  font-size: 24px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.primary};
  text-align: center;
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const ValidationError = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.error};
  margin-top: 4px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const Button = styled.button<{ $variant?: "primary" | "secondary" | "danger" }>`
  flex: 1;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  border: none;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s;

  ${({ $variant, theme }) => {
    if ($variant === "primary")
      return `
      background: ${theme.colors.primary};
      color: white;
      &:hover { opacity: 0.9; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    if ($variant === "danger")
      return `
      background: ${theme.colors.error};
      color: white;
      &:hover { opacity: 0.9; }
    `;
    return `
      background: ${theme.colors.background};
      color: ${theme.colors.text};
      border: 1px solid ${theme.colors.border};
      &:hover { background: ${theme.colors.border}; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
  }}
`;

const HiddenInput = styled.input`
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  pointer-events: none;
`;

export function BulkWeighModal({
  product,
  onAddToCart,
  onPrintAndScan,
  onCancel,
}: BulkWeighModalProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [weightInput, setWeightInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const productName = i18n.language === "uz" ? product.nameUz : product.nameRu;
  const pricePerKg = product.price;
  const minSaleQty = product.minSaleQty || 0;
  const maxSaleQty = product.maxSaleQty || 0;

  // Parse weight from input — scale sends e.g. "1.500" then Enter
  const weightKg = parseFloat(weightInput) || 0;

  const getWeightStatus = (): "zero" | "valid" | "invalid" => {
    if (weightKg === 0) return "zero";
    if (minSaleQty > 0 && weightKg < minSaleQty) return "invalid";
    if (maxSaleQty > 0 && weightKg > maxSaleQty) return "invalid";
    return "valid";
  };
  const status = getWeightStatus();
  const totalPrice = weightKg * pricePerKg;

  // Auto-focus hidden input to catch USB scale output
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [onCancel],
  );

  const validate = (): string | null => {
    if (weightKg <= 0) return t("bulkWeigh.enterWeight", "Введите вес");
    if (minSaleQty > 0 && weightKg < minSaleQty) {
      return t("bulkWeigh.minWeight") + `: ${minSaleQty} кг`;
    }
    if (maxSaleQty > 0 && weightKg > maxSaleQty) {
      return t("bulkWeigh.maxWeight") + `: ${maxSaleQty} кг`;
    }
    return null;
  };

  const handleAddNow = () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    onAddToCart(weightKg);
  };

  const handlePrintAndScan = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (!product.internalCode) {
      toast.error("Product has no internal code");
      return;
    }

    setIsCreating(true);
    try {
      const item = (await window.electronAPI.weighedItems.create({
        productId: product.id,
        internalCode: product.internalCode,
        weightKg,
        pricePerKg,
      })) as { id: string; barcode: string; totalPrice: number } | null;

      if (!item) throw new Error("Failed to create weighed item");

      // Print label
      try {
        await window.electronAPI.printer.printWeightedLabel({
          productNameRu: product.nameRu,
          productNameUz: product.nameUz,
          internalCode: product.internalCode,
          barcode: item.barcode,
          weightKg,
          pricePerKg,
          totalPrice: item.totalPrice,
          date: new Date().toLocaleDateString("ru-RU"),
        });
      } catch (printErr) {
        console.error("Label print failed:", printErr);
        // Continue even if print fails
      }

      toast.info(t("bulkWeigh.scanLabel"));
      onPrintAndScan(item.id, item.barcode);
    } catch (err) {
      console.error("Failed to create weighed item:", err);
      toast.error(t("common.error"));
    } finally {
      setIsCreating(false);
    }
  };

  const validationError = weightKg > 0 ? validate() : null;

  return (
    <Overlay
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <Modal>
        <Header>
          <Title>
            <Scale size={20} />
            {t("bulkWeigh.title")}
          </Title>
          <CloseButton onClick={onCancel}>
            <X size={18} />
          </CloseButton>
        </Header>

        <ProductInfo>
          <ProductName>{productName}</ProductName>
          <ProductMeta>
            <span>{pricePerKg.toLocaleString("ru-RU")} {t("bulkWeigh.sum")}/{t("bulkWeigh.kg")}</span>
            {minSaleQty > 0 && <span>min: {minSaleQty} {t("bulkWeigh.kg")}</span>}
            {maxSaleQty > 0 && <span>max: {maxSaleQty} {t("bulkWeigh.kg")}</span>}
          </ProductMeta>
        </ProductInfo>

        <WeightDisplay $status={status}>
          <WeightHint>{t("bulkWeigh.placeOnScale")}</WeightHint>
          <WeightValue $status={status}>
            {weightKg > 0 ? weightKg.toFixed(3) : "0.000"}
            <WeightUnit>{t("bulkWeigh.kg")}</WeightUnit>
          </WeightValue>
          {weightKg > 0 && (
            <TotalPrice>
              {totalPrice.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}{" "}
              {t("bulkWeigh.sum")}
            </TotalPrice>
          )}
          {validationError && (
            <ValidationError>{validationError}</ValidationError>
          )}
        </WeightDisplay>

        {/* Hidden input that receives USB scale output */}
        <HiddenInput
          ref={inputRef}
          value={weightInput}
          onChange={(e) =>
            setWeightInput(e.target.value.replace(/[^\d.]/g, ""))
          }
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        />

        <ButtonRow>
          <Button
            $variant="primary"
            onClick={handlePrintAndScan}
            disabled={status !== "valid" || isCreating}
          >
            <Printer size={16} />
            {isCreating ? t("common.processing") : t("bulkWeigh.printLabel")}
          </Button>
          <Button onClick={handleAddNow} disabled={status !== "valid"}>
            <ShoppingCart size={16} />
            {t("bulkWeigh.addNow")}
          </Button>
          <Button
            $variant="danger"
            onClick={onCancel}
            style={{ flex: "0 0 auto", width: "80px" }}
          >
            {t("common.cancel")}
          </Button>
        </ButtonRow>
      </Modal>
    </Overlay>
  );
}
