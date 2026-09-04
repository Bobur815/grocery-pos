import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { formatCurrency as formatCurrencyBase } from "@shared/utils";
import type { UzQrFinalResult } from "@shared/types/fiscal.types";

/**
 * On-screen UzQR payment.
 *
 * Opens as soon as the cashier picks UzQR, creates the invoice, and blocks until the buyer pays
 * or the wait ends. The sale is created by the CALLER, only on a PAID result — nothing is
 * written while this modal is open, so cancelling or timing out leaves the cart untouched.
 */

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
`;

const Panel = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.lg};
  width: min(560px, 92vw);
  max-height: 94vh;
  overflow-y: auto;
  padding: ${({ theme }) => theme.spacing.lg};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const AmountLine = styled.div`
  font-size: 20px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const QrFrame = styled.div`
  align-self: center;
  /* The QR must stay on white regardless of theme — a dark ground breaks scanner contrast. */
  background: #ffffff;
  padding: ${({ theme }) => theme.spacing.md};
  border-radius: ${({ theme }) => theme.borderRadius};
  line-height: 0;
`;

const QrImage = styled.img`
  display: block;
  width: min(340px, 62vw);
  height: auto;
  image-rendering: pixelated;
`;

/** Reserves the QR's footprint so the panel does not resize when the code arrives. */
const QrPlaceholder = styled.div`
  width: min(340px, 62vw);
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

const StatusLine = styled.div<{ $tone: "waiting" | "error" }>`
  text-align: center;
  font-size: 16px;
  color: ${({ theme, $tone }) =>
    $tone === "error" ? theme.colors.error : theme.colors.info};
`;

const InvoiceId = styled.div`
  text-align: center;
  font-family: monospace;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  word-break: break-all;
`;

const Hint = styled.div`
  text-align: center;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const CancelButton = styled.button`
  background-color: ${({ theme }) => theme.colors.error};
  color: #ffffff;
  border: none;
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.lg};
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

interface UzQrPaymentModalProps {
  amount: number;
  /** Fired only when the buyer actually paid — the caller then creates the sale. */
  onPaid: (payment: { vcrPaymentId: string; rrn: string | null }) => void;
  /** Cancelled, timed out, or failed to start. The cart must be left as it was. */
  onDismiss: (reason: { state: "TIMEOUT" | "CANCELLED" | "ERROR"; error?: string }) => void;
}

export function UzQrPaymentModal({ amount, onPaid, onDismiss }: UzQrPaymentModalProps) {
  const { t, i18n } = useTranslation();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const paymentIdRef = useRef<string | null>(null);
  // The effect runs once; without this, React 18 StrictMode's double-invoke would create two
  // invoices and the buyer could scan the one we are not watching.
  const startedRef = useRef(false);
  // Stops a late poll result from firing a callback after the modal has already resolved.
  const settledRef = useRef(false);

  const formatCurrency = (v: number) => formatCurrencyBase(v, i18n.language as "ru" | "uz");

  const settle = useCallback(
    (fn: () => void) => {
      if (settledRef.current) return;
      settledRef.current = true;
      fn();
    },
    [],
  );

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let alive = true;

    (async () => {
      const started = await window.electronAPI.uzqr.start(amount);
      if (!alive) return;

      if (!started.ok) {
        setError(started.error);
        // Left on screen rather than auto-dismissed: the cashier needs to read why before the
        // POS silently falls back to another tender.
        return;
      }

      paymentIdRef.current = started.vcrPaymentId;
      setQrDataUrl(started.qrDataUrl);
      setInvoiceId(started.invoiceId);

      const result: UzQrFinalResult = await window.electronAPI.uzqr.await(started.vcrPaymentId);
      if (!alive) return;

      if (result.ok) {
        settle(() => onPaid({ vcrPaymentId: result.vcrPaymentId, rrn: result.rrn }));
      } else if (result.state === "TIMEOUT") {
        settle(() => onDismiss({ state: "TIMEOUT" }));
      } else {
        settle(() => onDismiss({ state: "CANCELLED" }));
      }
    })();

    return () => {
      alive = false;
    };
    // Deliberately once-only — re-running would open a second invoice for the same cart.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);

    const id = paymentIdRef.current;
    if (!id) {
      // Nothing was created (start failed) — just close.
      settle(() => onDismiss({ state: "ERROR", error: error ?? undefined }));
      return;
    }

    await window.electronAPI.uzqr.cancel(id).catch(() => {});
    // The poll loop notices the cancel and resolves CANCELLED, which drives onDismiss. No
    // dismissal here, so a buyer who paid in the same instant is still reported as paid.
  }, [cancelling, error, onDismiss, settle]);

  // Escape cancels, matching every other POS modal. This component owns the key while open —
  // POSScreen's global handler is suppressed by its own guard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        void handleCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handleCancel]);

  return (
    <Overlay>
      <Panel role="dialog" aria-modal="true">
        <AmountLine>
          {t("pos.uzqrAmountDue", "К оплате")} {formatCurrency(amount)}
        </AmountLine>

        <QrFrame>
          {qrDataUrl ? (
            <QrImage src={qrDataUrl} alt={t("pos.uzqrScanHint", "Отсканируйте QR для оплаты")} />
          ) : (
            <QrPlaceholder>
              {error ? "" : t("pos.uzqrCreating", "Создание QR-кода…")}
            </QrPlaceholder>
          )}
        </QrFrame>

        {error ? (
          <StatusLine $tone="error">{error}</StatusLine>
        ) : (
          <>
            <StatusLine $tone="waiting">{t("pos.uzqrWaiting", "Идет оплата.")}</StatusLine>
            {qrDataUrl && <Hint>{t("pos.uzqrScanHint", "Отсканируйте QR для оплаты")}</Hint>}
          </>
        )}

        {invoiceId && <InvoiceId>{invoiceId}</InvoiceId>}

        <Actions>
          <CancelButton type="button" onClick={handleCancel} disabled={cancelling}>
            {cancelling ? t("common.processing") : t("common.cancel")}
          </CancelButton>
        </Actions>
      </Panel>
    </Overlay>
  );
}

export default UzQrPaymentModal;
