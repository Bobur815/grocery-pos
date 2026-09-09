import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useCartStore } from "../../store/cart-store";
import { useSidebar } from "../../context/SidebarContext";
import { useSales } from "../../hooks/useSales";
import { useToast } from "../../context/ToastContext";
import { Modal } from "../../components/common/Modal";
import { Button } from "../../components/common/Button";
import { NumberPad } from "../../components/common/NumberPad";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import { UZQR_BRAND_COLOR, type SaleTender } from "@shared/constants";
import { UzQrLogo } from "./UzQrLogo";
import { UzQrPaymentModal } from "./UzQrPaymentModal";
import { parseSaleError } from "./saleErrors";

const Content = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.lg};
  align-items: start;
`;

const LeftCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const RightCol = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const TotalSection = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.md};
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const TotalLabel = styled.div`
  font-size: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const TotalAmount = styled.div`
  font-size: 36px;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.primary};
`;

const SummarySection = styled.div`
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.sm};
`;

const SummaryRow = styled.div`
  display: flex;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.xs} 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PaymentMethods = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.spacing.md};
`;

const PaymentButton = styled.button<{ $selected?: boolean }>`
  padding: ${({ theme }) => theme.spacing.lg} ${({ theme }) => theme.spacing.sm};
  border: 2px solid
    ${({ theme, $selected }) =>
      $selected ? theme.colors.primary : theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme, $selected }) =>
    $selected ? theme.colors.primary + "15" : theme.colors.surface};
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

/**
 * The branded tile carries no text — the artwork is the label. The selected state has to
 * read against a navy field, so it adds a ring outside the border instead of the pale
 * primary wash the other two tiles use, which would be invisible here.
 */
const UzQrButton = styled(PaymentButton)`
  padding: ${({ theme }) => theme.spacing.sm};
  box-shadow: ${({ theme, $selected }) =>
    $selected ? `0 0 0 3px ${theme.colors.primary}40` : "none"};
  background-color: ${UZQR_BRAND_COLOR};
`;

const PaymentIcon = styled.span`
  font-size: 32px;
`;

const PaymentLabel = styled.span`
  font-size: 16px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const PrintCheckRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
  user-select: none;
`;

const Checkbox = styled.input`
  width: 20px;
  height: 20px;
  cursor: pointer;
  accent-color: ${({ theme }) => theme.colors.primary};
`;

const ShortcutHint = styled.span`
  font-size: 14px;
  opacity: 0.7;
  font-weight: 500;
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
`;

const CashHelper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const CashHelperLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-weight: 500;
`;

const DenominationRow = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: ${({ theme }) => theme.spacing.sm};
`;

const DenomButton = styled.button`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.xs}`};
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.primary};
    background-color: ${({ theme }) => theme.colors.primary + "12"};
    color: ${({ theme }) => theme.colors.primary};
  }

  &:active {
    transform: scale(0.96);
  }
`;

const ChangeDisplay = styled.div`
  display: flex;
  align-items: stretch;
  gap: ${({ theme }) => theme.spacing.sm};
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
`;

const ChangeCol = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
`;

const ChangeColLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ChangeColValue = styled.div<{ $positive?: boolean; $negative?: boolean }>`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme, $positive, $negative }) =>
    $positive
      ? theme.colors.success
      : $negative
        ? theme.colors.error
        : theme.colors.text};
`;

const ChangeDivider = styled.div`
  width: 1px;
  background-color: ${({ theme }) => theme.colors.border};
  align-self: stretch;
`;

const ClearButton = styled.button`
  align-self: flex-end;
  padding: 3px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.error};
    color: ${({ theme }) => theme.colors.error};
  }
`;

const CustomAmountRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const CustomAmountInput = styled.input`
  flex: 1;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
  outline: none;

  &:focus {
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  -moz-appearance: textfield;
`;



const DENOMINATIONS = [20000, 50000, 100000, 200000];

interface CheckoutProps {
  onComplete: () => void;
  onCancel: () => void;
}

export function Checkout({ onComplete, onCancel }: CheckoutProps) {
  const { t, i18n } = useTranslation();
  const { items, subtotal, tax, taxRate, discount, total, clearCart, editingSaleId } =
    useCartStore();
  const { createSale, updateSale, isLoading } = useSales();
  const toast = useToast();
  const [paymentMethod, setPaymentMethod] = useState<SaleTender>("cash");
  // Opt-in fiscalization: when ticked, the receipt is sent to REGOS:VCR to be fiscalized.
  // Default OFF — the sale is saved un-fiscalized and can be fiscalized later from Sales History.
  const [fiscalize, setFiscalize] = useState(false);
  // Only show the fiscalize toggle when REGOS:VCR is actually enabled.
  const [fiscalEnabled, setFiscalEnabled] = useState(false);

  // When on, choosing UzQR opens the QR modal and the sale is only created once the buyer pays.
  const [uzqrEnabled, setUzqrEnabled] = useState(false);
  const [uzQrAmount, setUzQrAmount] = useState<number | null>(null);

  useEffect(() => {
    window.electronAPI.fiscal
      .getConfig()
      .then((cfg) => setFiscalEnabled(cfg.enabled))
      .catch(() => {});
    window.electronAPI.uzqr
      .isEnabled()
      .then(setUzqrEnabled)
      // A failed check leaves UzQR as the plain tender it is today — never blocks a sale.
      .catch(() => setUzqrEnabled(false));
  }, []);
  const [givenAmount, setGivenAmount] = useState(0);
  const [customInput, setCustomInput] = useState("");

  const change = givenAmount - total;
  const isDiscount = givenAmount > 0 && change < 0;
  const discountFromUnderpayment = isDiscount ? Math.abs(change) : 0;

  /**
   * The "given amount" shortfall is a cash-drawer rounding courtesy and has no meaning for a QR
   * payment, where the bank app charges an exact figure. Left in, a cashier who typed a given
   * amount and then switched to UzQR would have the QR raised for `total` while the receipt
   * recorded less — the buyer paying more than their receipt says.
   */
  const isUzqrFlow = paymentMethod === "uzqr" && uzqrEnabled;
  const effectiveDiscount = isUzqrFlow ? discount : discount + discountFromUnderpayment;

  const formatCurrency = (amount: number) =>
    formatCurrencyBase(amount, i18n.language as "ru" | "uz");

  const addCustomAmount = () => {
    const parsed = parseFloat(customInput.replace(/\s/g, "").replace(",", "."));
    if (!isNaN(parsed) && parsed > 0) {
      setGivenAmount((prev) => prev + parsed);
      setCustomInput("");
    }
  };

  const handlePaymentRef = useRef<() => void>();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        handlePaymentRef.current?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /**
   * Write the sale. For UzQR this runs only AFTER the buyer has paid, with the confirmed
   * payment attached — the cart survives an abandoned or timed-out payment untouched.
   */
  const completeSale = async (uzqrPayment?: {
    vcrPaymentId: string;
    rrn: string | null;
  }) => {
    if (isLoading) return;

    try {
      const saleData = {
        items: items.map((item) => ({
          productId: String(item.productId),
          productName: item.productName,
          barcode: item.barcode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          piecesPerUnit: item.piecesPerUnit,
          preWeighedItemId: item.preWeighedItemId,
        })),
        paymentMethod,
        discountAmount: effectiveDiscount,
        markingCodes: items
          .filter((i) => i.markingCode)
          .map((i) => ({ barcode: i.barcode, label: i.markingCode! })),
        fiscalize,
        // Only set when the UzQR integration confirmed a payment. Its presence makes the sale
        // fiscalize immediately and book against the payment id rather than as a plain card.
        regosPaymentId: uzqrPayment?.vcrPaymentId,
        regosPaymentRrn: uzqrPayment?.rrn ?? undefined,
      };

      const sale = editingSaleId
        ? await updateSale(editingSaleId, saleData)
        : await createSale(saleData);

      if (sale) {
        // Record marking codes (group 022) for sold items — fire and forget
        const markingEntries = items
          .filter((i) => i.markingCode)
          .map((i) => ({ code: i.markingCode!, productBarcode: i.barcode }));
        if (markingEntries.length > 0) {
          window.electronAPI.markingCodes.record(markingEntries).catch(() => {});
        }

        clearCart();
        window.dispatchEvent(new Event("stock-updated"));
        toast.success(
          editingSaleId
            ? t("pos.saleUpdated")
            : `${t("pos.paymentComplete")} — ${t("pos.receiptNumber")}: ${sale.receiptNumber}`,
        );
        onComplete();
      }
    } catch (error) {
      const msg = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error("Payment failed:", error);
      window.electronAPI.logger.error(`Checkout.handlePayment: ${msg}`);

      if (uzqrPayment) {
        // Money already moved but the receipt did not. Surface the identifiers so the cashier
        // can reconcile rather than charging the buyer a second time.
        window.electronAPI.logger.error(
          `UzQR PAID BUT SALE FAILED — payment_id=${uzqrPayment.vcrPaymentId} rrn=${uzqrPayment.rrn ?? "-"}`,
        );
        toast.error(
          `${t("pos.uzqrPaidButSaleFailed", "Оплата прошла, но чек не создан. Сообщите администратору.")} ${uzqrPayment.rrn ?? uzqrPayment.vcrPaymentId}`,
        );
      } else {
        toast.error(parseSaleError(error, t));
      }
      clearCart();
      onComplete();
    }
  };

  /**
   * Pay button / F10. UzQR forks to the QR modal when the integration is on; every other tender
   * (and UzQR with it off) goes straight to the sale, exactly as before.
   */
  const handlePayment = async () => {
    if (isLoading) return;
    if (paymentMethod === "uzqr" && uzqrEnabled) {
      setUzQrAmount(total);
      return;
    }
    await completeSale();
  };

  handlePaymentRef.current = handlePayment;

  if (uzQrAmount !== null) {
    // Replaces the checkout panel rather than stacking on it — the cashier's only choices while
    // a QR is live are "buyer paid" or "cancel", and the tender buttons behind would be a trap.
    return (
      <UzQrPaymentModal
        amount={uzQrAmount}
        onPaid={(payment) => {
          setUzQrAmount(null);
          void completeSale(payment);
        }}
        onDismiss={(reason) => {
          setUzQrAmount(null);
          // Cart intact — the cashier can retry or pick another tender.
          if (reason.state === "TIMEOUT") {
            toast.error(t("pos.uzqrTimeout", "Время ожидания оплаты истекло"));
          } else if (reason.state === "ERROR" && reason.error) {
            toast.error(reason.error);
          }
        }}
      />
    );
  }

  return (
    <Modal title={t("pos.checkout")} onClose={onCancel} width="860px">
      <Content>
        <LeftCol>
          <TotalSection>
            <TotalLabel>{t("pos.totalToPay")}</TotalLabel>
            <TotalAmount>{formatCurrency(total)}</TotalAmount>
          </TotalSection>

          <SummarySection>
            <SummaryRow>
              <span>{t("pos.subtotal")}</span>
              <span>{formatCurrency(subtotal)}</span>
            </SummaryRow>
            {tax > 0 && (
              <SummaryRow>
                <span>sh.j. QQS {taxRate}%</span>
                <span>{formatCurrency(tax)}</span>
              </SummaryRow>
            )}
            {discount > 0 && (
              <SummaryRow>
                <span>{t("pos.discount")}</span>
                <span>-{formatCurrency(discount)}</span>
              </SummaryRow>
            )}
            <SummaryRow>
              <span>{t("pos.itemsCount")}</span>
              <span>{items.length}</span>
            </SummaryRow>
          </SummarySection>

          <PaymentMethods>
            <PaymentButton
              $selected={paymentMethod === "cash"}
              onClick={() => setPaymentMethod("cash")}
            >
              <PaymentIcon>💵</PaymentIcon>
              <PaymentLabel>{t("pos.cash")}</PaymentLabel>
            </PaymentButton>
            <PaymentButton
              $selected={paymentMethod === "card"}
              onClick={() => setPaymentMethod("card")}
            >
              <PaymentIcon>💳</PaymentIcon>
              <PaymentLabel>{t("pos.card")}</PaymentLabel>
            </PaymentButton>
            <UzQrButton
              $selected={paymentMethod === "uzqr"}
              onClick={() => setPaymentMethod("uzqr")}
              aria-label={t("pos.uzqr")}
              title={t("pos.uzqr")}
            >
              <UzQrLogo $height={45} $fill />
              <PaymentLabel style={{ color: "white" }}>{t("pos.uzqr")}</PaymentLabel>
            </UzQrButton>
          </PaymentMethods>

          <Actions>
            <Button variant="secondary" onClick={onCancel} fullWidth>
              {t("common.cancel")}
            </Button>
            <Button onClick={handlePayment} disabled={isLoading} fullWidth>
              {isLoading ? t("common.processing") : t("pos.confirmPayment")}{" "}
              <ShortcutHint>(F10)</ShortcutHint>
            </Button>
          </Actions>
        </LeftCol>

        <RightCol>
          {paymentMethod === "cash" && (
            <CashHelper>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <CashHelperLabel>{t("pos.cashReceived")}</CashHelperLabel>
                {givenAmount > 0 && (
                  <ClearButton onClick={() => setGivenAmount(0)}>
                    {t("pos.clearAmount")} ×
                  </ClearButton>
                )}
              </div>
              <DenominationRow>
                {DENOMINATIONS.map((denom) => (
                  <DenomButton
                    key={denom}
                    onClick={() => setGivenAmount((prev) => prev + denom)}
                  >
                    {(denom / 1000).toLocaleString()}K
                  </DenomButton>
                ))}
              </DenominationRow>
              <CustomAmountRow>
                <CustomAmountInput
                  type="text"
                  inputMode="none"
                  placeholder={t("pos.customAmount")}
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomAmount();
                    }
                  }}
                />
              </CustomAmountRow>
              <NumberPad
                onDigit={(d) =>
                  setCustomInput((prev) => {
                    if (d === "." && prev.includes(".")) return prev;
                    if ((d === "0" || d === "00") && prev === "") return prev;
                    return prev + d;
                  })
                }
                onBackspace={() => setCustomInput((prev) => prev.slice(0, -1))}
                onClear={() => setCustomInput("")}
                onEnter={addCustomAmount}
              />
              {givenAmount > 0 && (
                <ChangeDisplay>
                  <ChangeCol>
                    <ChangeColLabel>{t("pos.cashReceived")}</ChangeColLabel>
                    <ChangeColValue>
                      {formatCurrency(givenAmount)}
                    </ChangeColValue>
                  </ChangeCol>
                  <ChangeDivider />
                  <ChangeCol>
                    <ChangeColLabel>
                      {isDiscount ? t("pos.cashDiscount") : t("pos.cashChange")}
                    </ChangeColLabel>
                    <ChangeColValue $positive={change >= 0} $negative={false}>
                      {formatCurrency(Math.abs(change))}
                    </ChangeColValue>
                  </ChangeCol>
                </ChangeDisplay>
              )}
            </CashHelper>
          )}

          {fiscalEnabled && (
            <PrintCheckRow>
              <Checkbox
                type="checkbox"
                checked={fiscalize}
                onChange={(e) => setFiscalize(e.target.checked)}
              />
              {t("pos.fiscalize")}
            </PrintCheckRow>
          )}
        </RightCol>
      </Content>
    </Modal>
  );
}
