import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import { ShieldCheck, X } from "lucide-react";

/**
 * Manager-override gate.
 *
 * A super admin sets a password per store from the web dashboard; the terminal caches its bcrypt
 * hash and checks it locally, so this works for an OFFLINE_ONLY store that never reaches a server.
 *
 * Wrap a sensitive action rather than duplicating a prompt at each call site:
 *
 *     const gate = useSuperAdminGate();
 *     gate.require(() => deleteSale(id));
 *
 * **When no override is configured the action simply runs.** That is deliberate: the feature is
 * opt-in per store, and a terminal whose store has no password must behave exactly as it did
 * before this existed. It also means `require` is safe to add anywhere without waiting for every
 * store to be configured.
 */

interface SuperAdminGateValue {
  /** Run `action`, first demanding the override password if this store has one. */
  require: (action: () => void | Promise<void>) => Promise<void>;
}

const SuperAdminGateContext = createContext<SuperAdminGateValue | null>(null);

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
`;

const Dialog = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 24px;
  width: 100%;
  max-width: 400px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
`;

const Title = styled.h3`
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
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

const Hint = styled.p`
  font-size: 13px;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0 0 16px;
`;

const PasswordInput = styled.input`
  width: 100%;
  padding: 11px 12px;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  font-size: 16px;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
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

export function SuperAdminGateProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Held in a ref, not state: the pending action must survive re-renders and must not make the
  // dialog's identity depend on it.
  const pendingAction = useRef<(() => void | Promise<void>) | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPassword("");
    setError(null);
    setBusy(false);
    pendingAction.current = null;
  }, []);

  const require = useCallback(async (action: () => void | Promise<void>) => {
    // No override configured for this store — nothing to ask, so just do it.
    const configured = await window.electronAPI.auth.hasSuperAdminPassword().catch(() => false);
    if (!configured) {
      await action();
      return;
    }

    pendingAction.current = action;
    setPassword("");
    setError(null);
    setOpen(true);
  }, []);

  const submit = useCallback(async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await window.electronAPI.auth.verifySuperAdminPassword(password);
      if (!ok) {
        // One message for a wrong password and for the lockout that follows too many of them:
        // telling someone which of the two they hit only helps them time the next attempt.
        setError(t("superAdmin.wrongPassword"));
        setPassword("");
        return;
      }
      const action = pendingAction.current;
      close();
      // Run after closing, so a slow action does not leave the dialog hanging open.
      await action?.();
    } catch {
      setError(t("superAdmin.wrongPassword"));
    } finally {
      setBusy(false);
    }
  }, [password, busy, t, close]);

  return (
    <SuperAdminGateContext.Provider value={{ require }}>
      {children}
      {open && (
        <Overlay onClick={(e) => e.target === e.currentTarget && close()}>
          <Dialog>
            <Header>
              <Title>
                <ShieldCheck size={19} />
                {t("superAdmin.title")}
              </Title>
              <CloseButton onClick={close} type="button">
                <X size={18} />
              </CloseButton>
            </Header>
            <Hint>{t("superAdmin.hint")}</Hint>
            <PasswordInput
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
            {error && <ErrorText>{error}</ErrorText>}
            <Actions>
              <ActionButton type="button" onClick={close}>
                {t("common.cancel")}
              </ActionButton>
              <ActionButton type="button" $primary disabled={!password || busy} onClick={submit}>
                {t("common.confirm")}
              </ActionButton>
            </Actions>
          </Dialog>
        </Overlay>
      )}
    </SuperAdminGateContext.Provider>
  );
}

export function useSuperAdminGate(): SuperAdminGateValue {
  const context = useContext(SuperAdminGateContext);
  if (!context) {
    throw new Error("useSuperAdminGate must be used within a SuperAdminGateProvider");
  }
  return context;
}
