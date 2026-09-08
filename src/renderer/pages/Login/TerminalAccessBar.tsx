import { useState } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { CreditCard, ExternalLink, Settings, Smartphone, X } from "lucide-react";
import { formatCurrency } from "../../../shared/utils/transformers";
import { useToast } from "../../context/ToastContext";
import type { StoreSubscription } from "../../../shared/types/store.types";

/**
 * The terminal-level controls at the bottom of the login screen.
 *
 * Settings edits the server URL this terminal talks to. Because the login screen is
 * unauthenticated, that would otherwise let anyone repoint the terminal at a server of their
 * choosing, so it is gated on the store PIN (or an admin password on a terminal with no PIN).
 *
 * The phone button shows the web admin dashboard address as a QR, and the card button shows the
 * store's subscription status with a way to pay for it. Neither is hidden for an OFFLINE_ONLY
 * store: such a store still has a subscription with the vendor, and its dashboard is served by
 * this terminal on the shop's own network. What changes offline is only what the terminal can
 * reach — so the subscription button checks for a connection first and says plainly when there
 * is none, rather than the button disappearing.
 */

const Bar = styled.div`
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 22px;
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.text};
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
`;

const Dialog = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 420px;
`;

const DialogHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 18px;
`;

const DialogTitle = styled.h3`
  margin: 0;
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text};
`;

const CloseButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;

  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 6px;
`;

const TextInput = styled.input`
  width: 100%;
  padding: 11px 12px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 15px;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const Hint = styled.p`
  font-size: 12px;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 8px 0 0;
`;

const ErrorText = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.error};
  margin: 10px 0 0;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
`;

const ActionButton = styled.button<{ $primary?: boolean }>`
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid
    ${({ $primary, theme }) => ($primary ? theme.colors.primary : theme.colors.border)};
  background: ${({ $primary, theme }) => ($primary ? theme.colors.primary : "transparent")};
  color: ${({ $primary, theme }) => ($primary ? "#fff" : theme.colors.text)};

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

/* The QR must stay on white regardless of theme — a dark ground breaks scanner contrast. */
const QrFrame = styled.div`
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  justify-content: center;
`;

const QrImage = styled.img`
  width: 240px;
  height: 240px;
  display: block;
`;

const UrlText = styled.p`
  font-size: 13px;
  text-align: center;
  word-break: break-all;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 14px 0 0;
`;

const InfoRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-of-type {
    border-bottom: none;
  }
`;

const InfoLabel = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const InfoValue = styled.span<{ $muted?: boolean; $warn?: boolean }>`
  font-size: 15px;
  font-weight: 600;
  text-align: right;
  color: ${({ $muted, $warn, theme }) =>
    $warn ? theme.colors.error : $muted ? theme.colors.textSecondary : theme.colors.text};
`;

/* The pay dialog leads with the QR, so it needs more room than the plain 420px dialogs. */
const WideDialog = styled(Dialog)`
  max-width: 460px;
  max-height: 90vh;
  overflow-y: auto;
`;

const LinkButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 13px 16px;
  margin-top: 16px;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;

  &:hover {
    opacity: 0.9;
  }
`;

const SupportPhone = styled.p`
  font-size: 15px;
  font-weight: 600;
  text-align: center;
  color: ${({ theme }) => theme.colors.text};
  margin: 12px 0 0;
`;

type Dialog = "none" | "unlock" | "server" | "qr" | "subscription" | "pay";

/** Renders an ISO timestamp as a plain date, or a dash when the plan has no expiry. */
function formatExpiry(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function TerminalAccessBar() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>("none");

  const [secret, setSecret] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [qr, setQr] = useState<{
    url: string;
    qrDataUrl: string | null;
    local: boolean;
    error: string | null;
  } | null>(null);
  const [qrLoaded, setQrLoaded] = useState(false);
  const [subscription, setSubscription] = useState<StoreSubscription | null>(null);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setDialog("none");
    setSecret("");
    setError(null);
  };

  const handleUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await window.electronAPI.auth.verifyTerminalAccess(secret);
      if (!ok) {
        setError(t("settings.terminalAccessDenied"));
        return;
      }
      const cfg = await window.electronAPI.config.getLocalConfig();
      setApiUrl(cfg?.apiUrl ?? "");
      setSecret("");
      setDialog("server");
    } catch {
      setError(t("settings.terminalAccessDenied"));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveUrl = async () => {
    const trimmed = apiUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      setError(t("settings.serverUrlInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await window.electronAPI.config.updateLocalConfig({ apiUrl: trimmed });
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settings.serverUrlInvalid"));
    } finally {
      setBusy(false);
    }
  };

  const openQr = async () => {
    setDialog("qr");
    setQrLoaded(false);
    setQr(await window.electronAPI.config.getWebAdminQr().catch(() => null));
    setQrLoaded(true);
  };

  const openSubscription = async () => {
    // Subscription state only exists on the vendor's server, so there is nothing worth opening
    // without a connection — a dialog of dashes helps nobody. Probe the server this terminal is
    // actually configured against, so a staging terminal is judged against staging.
    const cfg = await window.electronAPI.config.getLocalConfig().catch(() => null);
    if (!(await window.electronAPI.app.isOnline(cfg?.apiUrl))) {
      toast.error(t("errors.noInternet"));
      return;
    }

    setDialog("subscription");
    // Kept separate from `busy`: this read can take seconds against a slow VPS, and it must not
    // leave the unlock dialog's confirm button disabled if the user closes and reopens.
    setLoadingSubscription(true);
    // A failed read still returns the cached snapshot, so the dialog only ever goes empty on a
    // terminal that has never reached the server.
    setSubscription(await window.electronAPI.subscription.get().catch(() => null));
    setLoadingSubscription(false);
  };

  const openPaymentLink = () => {
    const url = subscription?.payment.paymentUrl;
    if (url) void window.electronAPI.subscription.openPaymentLink(url);
  };

  const expired =
    !!subscription?.expiresAt && new Date(subscription.expiresAt).getTime() < Date.now();

  // Nothing to pay with until the operator has configured a QR payload or a pay link, so the
  // button stays disabled rather than opening an empty dialog.
  const canPay = !!(subscription?.payment.qrDataUrl || subscription?.payment.paymentUrl);

  return (
    <>
      <Bar>
        <IconButton
          type="button"
          onClick={() => setDialog("unlock")}
          title={t("settings.serverUrl")}
          aria-label={t("settings.serverUrl")}
        >
          <Settings size={19} />
        </IconButton>

        <IconButton
          type="button"
          onClick={openQr}
          title={t("settings.webAdminOnPhone")}
          aria-label={t("settings.webAdminOnPhone")}
        >
          <Smartphone size={19} />
        </IconButton>

        <IconButton
          type="button"
          onClick={openSubscription}
          title={t("subscription.statusTitle")}
          aria-label={t("subscription.statusTitle")}
        >
          <CreditCard size={19} />
        </IconButton>
      </Bar>

      {dialog === "unlock" && (
        <Overlay onClick={(e) => e.target === e.currentTarget && close()}>
          <Dialog>
            <DialogHeader>
              <DialogTitle>{t("settings.terminalAccessTitle")}</DialogTitle>
              <CloseButton onClick={close}>
                <X size={18} />
              </CloseButton>
            </DialogHeader>
            <Label>{t("settings.terminalAccessSecret")}</Label>
            <TextInput
              type="password"
              value={secret}
              autoFocus
              onChange={(e) => setSecret(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            />
            <Hint>{t("settings.terminalAccessHint")}</Hint>
            {error && <ErrorText>{error}</ErrorText>}
            <Actions>
              <ActionButton type="button" onClick={close}>
                {t("common.cancel")}
              </ActionButton>
              <ActionButton type="button" $primary disabled={busy || !secret} onClick={handleUnlock}>
                {t("common.confirm")}
              </ActionButton>
            </Actions>
          </Dialog>
        </Overlay>
      )}

      {dialog === "server" && (
        <Overlay onClick={(e) => e.target === e.currentTarget && close()}>
          <Dialog>
            <DialogHeader>
              <DialogTitle>{t("settings.serverUrl")}</DialogTitle>
              <CloseButton onClick={close}>
                <X size={18} />
              </CloseButton>
            </DialogHeader>
            <Label>{t("settings.serverUrl")}</Label>
            <TextInput
              value={apiUrl}
              autoFocus
              spellCheck={false}
              placeholder="https://pos.bobur-dev.uz/api"
              onChange={(e) => setApiUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveUrl()}
            />
            <Hint>{t("settings.serverUrlHint")}</Hint>
            {error && <ErrorText>{error}</ErrorText>}
            <Actions>
              <ActionButton type="button" onClick={close}>
                {t("common.cancel")}
              </ActionButton>
              <ActionButton type="button" $primary disabled={busy} onClick={handleSaveUrl}>
                {t("common.save")}
              </ActionButton>
            </Actions>
          </Dialog>
        </Overlay>
      )}

      {dialog === "qr" && (
        <Overlay onClick={(e) => e.target === e.currentTarget && close()}>
          <Dialog>
            <DialogHeader>
              <DialogTitle>{t("settings.webAdminOnPhone")}</DialogTitle>
              <CloseButton onClick={close}>
                <X size={18} />
              </CloseButton>
            </DialogHeader>
            {qr?.qrDataUrl && (
              <QrFrame>
                <QrImage src={qr.qrDataUrl} alt={t("settings.webAdminOnPhone")} />
              </QrFrame>
            )}
            {/* A local dashboard is reached over the shop's own Wi-Fi, not the internet, so it
                needs different instructions from the hosted one. A null reply means there is no
                address to hand out — no LAN address locally, or no server configured. */}
            <Hint>
              {!qr && qrLoaded
                ? t("settings.webAdminUnavailable")
                : qr?.local
                  ? t("settings.webAdminLocalHint")
                  : t("settings.webAdminHint")}
            </Hint>
            {qr?.url && <UrlText>{qr.url}</UrlText>}
            {qr?.error && <ErrorText>{qr.error}</ErrorText>}
            <Actions>
              <ActionButton type="button" $primary onClick={close}>
                {t("common.close")}
              </ActionButton>
            </Actions>
          </Dialog>
        </Overlay>
      )}

      {dialog === "subscription" && (
        <Overlay onClick={(e) => e.target === e.currentTarget && close()}>
          <Dialog>
            <DialogHeader>
              <DialogTitle>{t("subscription.statusTitle")}</DialogTitle>
              <CloseButton onClick={close}>
                <X size={18} />
              </CloseButton>
            </DialogHeader>

            {loadingSubscription && !subscription ? (
              <Hint>{t("common.loading")}</Hint>
            ) : (
              <>
                <InfoRow>
                  <InfoLabel>{t("subscription.title")}</InfoLabel>
                  <InfoValue $muted={!subscription?.plan}>
                    {subscription?.plan ?? t("subscription.noplan")}
                  </InfoValue>
                </InfoRow>

                <InfoRow>
                  <InfoLabel>{t("subscription.expiresAt")}</InfoLabel>
                  <InfoValue
                    $muted={!subscription?.plan}
                    $warn={expired}
                  >
                    {!subscription?.plan
                      ? "—"
                      : (formatExpiry(subscription.expiresAt, i18n.language) ??
                        t("subscription.perpetual"))}
                  </InfoValue>
                </InfoRow>

                <InfoRow>
                  <InfoLabel>{t("subscription.aiPlan")}</InfoLabel>
                  <InfoValue>
                    {subscription?.aiPlan === "paid"
                      ? t("subscription.aiPlanPaid")
                      : t("subscription.aiPlanFree")}
                  </InfoValue>
                </InfoRow>

                <InfoRow>
                  <InfoLabel>{t("subscription.storeBalance")}</InfoLabel>
                  <InfoValue $muted={subscription?.balanceUzs == null}>
                    {subscription?.balanceUzs == null
                      ? "—"
                      : formatCurrency(
                          subscription.balanceUzs,
                          i18n.language === "uz" ? "uz" : "ru",
                        )}
                  </InfoValue>
                </InfoRow>

                {/* Say so rather than passing off a cached snapshot as the live state. */}
                {subscription?.stale && <Hint>{t("subscription.offlineHint")}</Hint>}
              </>
            )}

            <Actions>
              <ActionButton type="button" onClick={close}>
                {t("common.close")}
              </ActionButton>
              <ActionButton
                type="button"
                $primary
                disabled={!canPay}
                onClick={() => {
                  setError(null);
                  setDialog("pay");
                }}
              >
                {t("subscription.payAction")}
              </ActionButton>
            </Actions>
          </Dialog>
        </Overlay>
      )}

      {dialog === "pay" && (
        <Overlay onClick={(e) => e.target === e.currentTarget && close()}>
          <WideDialog>
            <DialogHeader>
              <DialogTitle>{t("subscription.payTitle")}</DialogTitle>
              <CloseButton onClick={close}>
                <X size={18} />
              </CloseButton>
            </DialogHeader>

            {subscription?.payment.qrDataUrl && (
              <>
                <Hint style={{ margin: "0 0 14px" }}>{t("subscription.payScanHint")}</Hint>
                <QrFrame>
                  <QrImage
                    src={subscription.payment.qrDataUrl}
                    alt={t("subscription.payTitle")}
                  />
                </QrFrame>
                <Hint>{t("subscription.payCallHint")}</Hint>
                {subscription.payment.supportPhone && (
                  <SupportPhone>{subscription.payment.supportPhone}</SupportPhone>
                )}
              </>
            )}

            {subscription?.payment.paymentUrl && (
              <>
                <Hint>{t("subscription.payLinkHint")}</Hint>
                <LinkButton type="button" onClick={openPaymentLink}>
                  <ExternalLink size={17} />
                  {t("subscription.payOnline")}
                </LinkButton>
              </>
            )}

            <Actions>
              <ActionButton type="button" $primary onClick={close}>
                {t("common.close")}
              </ActionButton>
            </Actions>
          </WideDialog>
        </Overlay>
      )}
    </>
  );
}
