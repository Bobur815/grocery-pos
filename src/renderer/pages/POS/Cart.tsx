import React, { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useCartStore } from "../../store/cart-store";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { EmptyPlaceholder } from "../../components/common/EmptyPlaceholder";
import { AlertTriangle, History, ShoppingCart, Trash, X } from "lucide-react";
import { SalesHistoryModal } from "./SalesHistoryModal";
import type { Sale } from "@shared/types/sale.types";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { formatQuantity } from "../../utils/formatters";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`;

const Header = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 20px;
  color: ${({ theme }) => theme.colors.text};
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const IconButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  border-radius: 4px;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
    background-color: ${({ theme }) => theme.colors.primary}10;
  }
`;

const ClearButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.error};
  cursor: pointer;
  font-size: 24px;

  &:hover {
    text-decoration: underline;
  }
`;

const EditBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  background-color: ${({ theme }) => theme.colors.warning}15;
  border-bottom: 1px solid ${({ theme }) => theme.colors.warning}40;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
`;

const EditBannerInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const EditBannerLabel = styled.span`
  font-weight: 600;
  color: ${({ theme }) => theme.colors.warning};
  font-size: 14px;
  text-transform: uppercase;
`;

const EditBannerReceipt = styled.span`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const CancelEditButton = styled.button`
  background: none;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  padding: 4px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;

  &:hover {
    color: ${({ theme }) => theme.colors.error};
    border-color: ${({ theme }) => theme.colors.error};
  }
`;

const ItemsList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.sm};
`;

const QuantityRow = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const CartItem = styled.div`
  display: flex;
  flex-direction: column;
  padding: ${({ theme }) => theme.spacing.sm};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const ItemRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ItemName = styled.span`
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
  font-size: 18px;
`;

const ItemPrice = styled.span`
  color: ${({ theme }) => theme.colors.primary};
  font-weight: bold;
  font-size: 18px;
`;

/** Marks a line sold as a whole box, so it can't be mistaken for the same product per piece. */
const BoxBadge = styled.span`
  margin-left: ${({ theme }) => theme.spacing.xs};
  padding: 1px 6px;
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.primary}1a;
  color: ${({ theme }) => theme.colors.primary};
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
`;

const QuantityControls = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.xs};
`;

const QuantityButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  transition:
    transform 0.1s ease,
    background-color 0.1s ease,
    color 0.1s ease,
    box-shadow 0.1s ease;
  &:hover {
    background-color: ${({ theme }) => theme.colors.primary};
    color: white;
  }

  &:active {
    transform: scale(0.88);
    background-color: ${({ theme }) => theme.colors.primary};
    color: white;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.25);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const Quantity = styled.span`
  width: 80px;
  text-align: center;
  font-weight: 500;
  font-size: 18px;
`;

const RemoveButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.error};
  cursor: pointer;
  font-size: 18px;
  margin-left: auto;
  transition:
    transform 0.1s ease,
    opacity 0.1s ease;

  &:hover {
    text-decoration: underline;
    opacity: 0.75;
  }

  &:active {
    transform: scale(0.85);
    opacity: 0.6;
  }
`;

const Footer = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  background-color: ${({ theme }) => theme.colors.background};
`;

const TotalsSection = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const TotalRow = styled.div<{ $bold?: boolean; $large?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${({ theme }) => theme.spacing.xs} 0;

  ${({ $bold }) => $bold && `font-weight: bold;`}
  ${({ $large }) =>
    $large &&
    `
    font-size: 34px;
    padding-top: 8px;
    margin-top: 8px;
    border-top: 2px solid currentColor;
  `}
`;

const TotalLabel = styled.span<{ $muted?: boolean }>`
  color: ${({ theme, $muted }) =>
    $muted ? theme.colors.textSecondary : theme.colors.text};
`;

const TotalAmount = styled.span<{ $primary?: boolean; $negative?: boolean }>`
  color: ${({ theme, $primary, $negative }) =>
    $negative
      ? theme.colors.error
      : $primary
        ? theme.colors.primary
        : theme.colors.text};
`;

export function Cart() {
  const { t, i18n } = useTranslation();
  const {
    items,
    subtotal,
    tax,
    discount,
    total,
    updateQuantity,
    removeItem,
    clearCart,
    loadSaleForEdit,
    editingSaleId,
    editingSaleReceipt,
  } = useCartStore();
  const formatCurrency = useCallback(
    (amount: number) =>
      formatCurrencyBase(amount, i18n.language as "ru" | "uz"),
    [i18n.language],
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleEditSale = useCallback(
    (sale: Sale) => {
      const cartItems = sale.items.map((item) => ({
        productId: Number(item.productId),
        productName: item.productName,
        barcode: item.barcode,
        unitPrice: Number(item.unitPrice),
        quantity: Number(item.quantity),
        stock: Number(item.quantity) + 100,
        unit: undefined,
        // Must survive the round-trip: without it a re-saved box line would decrement stock
        // by boxes instead of pieces, and the line would lose its "кор. x N" identity.
        piecesPerUnit: item.piecesPerUnit ?? 1,
      }));
      loadSaleForEdit(sale.id, sale.receiptNumber, cartItems);
      setShowHistory(false);
    },
    [loadSaleForEdit],
  );

  // REGOS:VCR fiscalization status — poll so staff see unfiscalized receipts.
  const [fiscalQueue, setFiscalQueue] = useState<{
    enabled: boolean;
    pending: number;
    failed: number;
  } | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      window.electronAPI.fiscal
        .getStatus()
        .then((s) => {
          if (active) setFiscalQueue(s);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const unfiscalized = (fiscalQueue?.failed ?? 0) + (fiscalQueue?.pending ?? 0);

  return (
    <Container>
      <Header>
        <Title>
          {t("pos.cart")} ({items.length})
        </Title>
        <HeaderActions>
          {fiscalQueue?.enabled && unfiscalized > 0 && (
            <div
              onClick={() => setShowHistory(true)}
              title={t("pos.fiscalUnsentHint", "Открыть историю для фискализации")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                color: "#fff",
                cursor: "pointer",
                background: (fiscalQueue?.failed ?? 0) > 0 ? "#d32f2f" : "#ed6c02",
              }}
            >
              <AlertTriangle size={16} />
              {t("pos.fiscalUnsent", { count: unfiscalized })}
            </div>
          )}
          <IconButton
            onClick={() => setShowHistory(true)}
            title={t("pos.salesHistory")}
          >
            <History size={30} />
          </IconButton>
          {items.length > 0 && (
            <ClearButton onClick={() => setShowClearConfirm(true)}>
              {" "}
              {t("common.clear")}
            </ClearButton>
          )}
        </HeaderActions>
      </Header>

      {editingSaleId && (
        <EditBanner>
          <EditBannerInfo>
            <EditBannerLabel>{t("pos.editingSale")}</EditBannerLabel>
            <EditBannerReceipt>#{editingSaleReceipt}</EditBannerReceipt>
          </EditBannerInfo>
          <CancelEditButton onClick={clearCart}>
            <X size={14} />
            {t("common.cancel")}
          </CancelEditButton>
        </EditBanner>
      )}

      {items.length === 0 ? (
        <EmptyPlaceholder
          icon={<ShoppingCart size={48} />}
          title={t("pos.emptyCart")}
        />
      ) : (
        <ItemsList>
          {items.map((item, index) => {
            const isWeighed = item.unit === "кг" || item.unit === "л";
            const step = isWeighed ? 0.1 : 1;

            // A box line and a piece line of the same product can coexist, so the multiplier
            // is part of the line's identity — for the React key and for every store lookup.
            const piecesPerUnit = item.piecesPerUnit ?? 1;
            const isBox = piecesPerUnit > 1;

            return (
              <CartItem
                key={`${item.productId}-${item.unitPrice}-${piecesPerUnit}`}
              >
                <ItemRow>
                  <ItemName>
                    {item.productName}
                    {isBox && (
                      <BoxBadge>
                        {t("saleUnit.boxShort", "кор.")} x{piecesPerUnit}
                      </BoxBadge>
                    )}
                  </ItemName>
                  <ItemPrice>
                    {formatCurrency(item.unitPrice * item.quantity)}
                  </ItemPrice>
                </ItemRow>
                <QuantityControls>
                  <QuantityRow>
                    <QuantityButton
                      onClick={() =>
                        updateQuantity(
                          item.productId,
                          Math.round((item.quantity - step) * 100) / 100,
                          item.unitPrice,
                          piecesPerUnit,
                        )
                      }
                    >
                      -
                    </QuantityButton>
                    <Quantity>
                      {/* A box line counts BOXES, so labelling it "шт" would read as pieces
                          and contradict the total. formatQuantity passes an unknown unit
                          through verbatim, which is exactly what the localised label needs. */}
                      {formatQuantity(
                        item.quantity,
                        isBox
                          ? t("saleUnit.boxShort", "кор.")
                          : item.unit || "шт",
                        i18n.language as "ru" | "uz",
                      )}
                    </Quantity>
                    <QuantityButton
                      onClick={() =>
                        updateQuantity(
                          item.productId,
                          Math.round((item.quantity + step) * 100) / 100,
                          item.unitPrice,
                          piecesPerUnit,
                        )
                      }
                      disabled={item.quantity >= item.stock || !!item.preWeighedItemId}
                    >
                      +
                    </QuantityButton>
                    x<ItemPrice>{formatCurrency(item.unitPrice)}</ItemPrice>
                  </QuantityRow>
                  <RemoveButton
                    onClick={() =>
                      removeItem(item.productId, item.unitPrice, piecesPerUnit)
                    }
                  >
                    <Trash size={26} />
                  </RemoveButton>
                </QuantityControls>
              </CartItem>
            );
          })}
        </ItemsList>
      )}

      <Footer>
        <TotalsSection>
          <TotalRow>
            <TotalLabel $muted>{t("pos.subtotal")}:</TotalLabel>
            <TotalAmount>{formatCurrency(subtotal)}</TotalAmount>
          </TotalRow>
          {tax > 0 && (
            <TotalRow>
              <TotalLabel $muted>{t("pos.tax")}:</TotalLabel>
              <TotalAmount>{formatCurrency(tax)}</TotalAmount>
            </TotalRow>
          )}
          {discount > 0 && (
            <TotalRow>
              <TotalLabel $muted>{t("pos.discount")}:</TotalLabel>
              <TotalAmount $negative>-{formatCurrency(discount)}</TotalAmount>
            </TotalRow>
          )}
          <TotalRow $bold $large>
            <TotalLabel>{t("pos.total")}:</TotalLabel>
            <TotalAmount $primary>{formatCurrency(total)}</TotalAmount>
          </TotalRow>
        </TotalsSection>
      </Footer>

      {showHistory && (
        <SalesHistoryModal
          onClose={() => setShowHistory(false)}
          onEditSale={handleEditSale}
        />
      )}

      {showClearConfirm && (
        <ConfirmDialog
          title={t("common.clear")}
          message={t(
            "pos.clearCartConfirm",
            "Are you sure you want to clear the cart?",
          )}
          confirmLabel={t("common.clear")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={() => {
            clearCart();
            setShowClearConfirm(false);
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </Container>
  );
}
