import { useEffect, useState } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { Settings, Smartphone, X } from "lucide-react";

/**
 * The two terminal-level controls at the bottom of the login screen.
 *
 * Settings edits the server URL this terminal talks to. Because the login screen is
 * unauthenticated, that would otherwise let anyone repoint the terminal at a server of their
 * choosing, so it is gated on the store PIN (or an admin password on a terminal with no PIN).
 *
 * The phone button shows the web admin dashboard address as a QR. It is hidden for an
 * OFFLINE_ONLY store, which has no server and therefore no dashboard.
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

type Dialog = "none" | "unlock" | "server" | "qr";

export function TerminalAccessBar() {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<Dialog>("none");
  const [offlineOnly, setOfflineOnly] = useState(false);

  const [secret, setSecret] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [qr, setQr] = useState<{ url: string; qrDataUrl: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.electronAPI.config
      .getLocalConfig()
      .then((cfg) => setOfflineOnly(cfg?.mode === "OFFLINE_ONLY"))
      .catch(() => {});
  }, []);

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
    setQr(await window.electronAPI.config.getWebAdminQr().catch(() => null));
  };

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

        {/* An offline store has no dashboard to open on a phone. */}
        {!offlineOnly && (
          <IconButton
            type="button"
            onClick={openQr}
            title={t("settings.webAdminOnPhone")}
            aria-label={t("settings.webAdminOnPhone")}
          >
            <Smartphone size={19} />
          </IconButton>
        )}
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
            <Hint>{t("settings.webAdminHint")}</Hint>
            {qr?.url && <UrlText>{qr.url}</UrlText>}
            <Actions>
              <ActionButton type="button" $primary onClick={close}>
                {t("common.close")}
              </ActionButton>
            </Actions>
          </Dialog>
        </Overlay>
      )}
    </>
  );
}
