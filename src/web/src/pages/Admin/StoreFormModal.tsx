import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { X } from "lucide-react";
import { stores, StoreRecord, StoreMode } from "../../api/client";
import { UzbekPhoneInput } from "@components/common/UzbekPhoneInput";
import { phoneToDigits, normalizeUzPhone } from "@shared/utils/phone";

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;

const Modal = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 10px;
  width: 100%;
  max-width: 480px;
  padding: 24px;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
`;

const ModalTitle = styled.h2`
  margin: 0;
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text};
`;

const CloseBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  &:hover {
    color: ${({ theme }) => theme.colors.text};
  }
`;

const Field = styled.div`
  margin-bottom: 16px;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 6px;
`;

const Input = styled.input`
  width: 100%;
  padding: 9px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  font-size: 14px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  box-sizing: border-box;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const Select = styled.select`
  width: 100%;
  padding: 9px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  font-size: 14px;
  background: ${({ theme }) => theme.colors.background};
  color: ${({ theme }) => theme.colors.text};
  box-sizing: border-box;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const CheckRow = styled.label<{ $disabled?: boolean }>`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  cursor: ${({ $disabled }) => ($disabled ? "default" : "pointer")};
  opacity: ${({ $disabled }) => ($disabled ? 0.5 : 1)};
`;

const Hint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 6px;
  line-height: 1.4;
`;

const FooterActions = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 24px;
`;

const Btn = styled.button<{ $primary?: boolean }>`
  padding: 9px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid
    ${({ $primary, theme }) =>
      $primary ? theme.colors.primary : theme.colors.border};
  background: ${({ $primary, theme }) =>
    $primary ? theme.colors.primary : "transparent"};
  color: ${({ $primary }) => ($primary ? "#fff" : "inherit")};
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const ErrorMsg = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 13px;
  margin-top: 12px;
`;

interface Props {
  store: StoreRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

export function StoreFormModal({ store, onClose, onSaved }: Props) {
  const isNew = store === null;
  const [name, setName] = useState(store?.name ?? "");
  const [address, setAddress] = useState(store?.address ?? "");
  const [phoneDigits, setPhoneDigits] = useState(phoneToDigits(store?.phone ?? ""));
  const [mode, setMode] = useState<StoreMode>(store?.mode ?? "ONLINE");
  const [posAdminLocked, setPosAdminLocked] = useState(store?.posAdminLocked ?? false);
  // Always starts blank — the server never returns the password, only whether one exists. Blank
  // therefore means "leave as-is", which is why clearing needs its own explicit control.
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const [clearSuperAdminPassword, setClearSuperAdminPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An OFFLINE_ONLY store keeps full local CRUD by definition, so the lock has no meaning there.
  const lockApplies = mode === "ONLINE";

  useEffect(() => {
    setName(store?.name ?? "");
    setAddress(store?.address ?? "");
    setPhoneDigits(phoneToDigits(store?.phone ?? ""));
    setMode(store?.mode ?? "ONLINE");
    setPosAdminLocked(store?.posAdminLocked ?? false);
    setSuperAdminPassword("");
    setClearSuperAdminPassword(false);
  }, [store]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Store name is required.");
      return;
    }
    if (superAdminPassword && superAdminPassword.length < 4) {
      setError("The manager password must be at least 4 characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        address: address.trim() || undefined,
        phone: phoneDigits ? normalizeUzPhone(phoneDigits) : undefined,
        mode,
        // Never persist a lock on an offline store — it would be a no-op the terminal still reads.
        posAdminLocked: lockApplies ? posAdminLocked : false,
        // Three states, matching what the API expects: omitted leaves the current password alone,
        // "" clears it, a value replaces it.
        ...(clearSuperAdminPassword
          ? { superAdminPassword: "" }
          : superAdminPassword
            ? { superAdminPassword }
            : {}),
      };
      if (isNew) {
        await stores.create(payload);
      } else {
        await stores.update(store.id, payload);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.message ?? (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Modal>
        <ModalHeader>
          <ModalTitle>{isNew ? "New Store" : "Edit Store"}</ModalTitle>
          <CloseBtn onClick={onClose}>
            <X size={18} />
          </CloseBtn>
        </ModalHeader>

        <form onSubmit={handleSubmit}>
          <Field>
            <Label>Store name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Downtown Grocery"
              autoFocus
            />
          </Field>
          <Field>
            <Label>Address</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 123 Main Street, Tashkent"
            />
          </Field>
          <Field>
            <UzbekPhoneInput
              label="Phone"
              valueDigits={phoneDigits}
              onDigitsChange={setPhoneDigits}
            />
          </Field>

          <Field>
            <Label>Mode</Label>
            <Select value={mode} onChange={(e) => setMode(e.target.value as StoreMode)}>
              <option value="ONLINE">Online — server is the source of truth</option>
              <option value="OFFLINE_ONLY">Offline only — terminal is the source of truth, no sync</option>
            </Select>
            <Hint>
              {mode === "ONLINE"
                ? "The terminal syncs to this server and pulls product, user and supplier data down from it."
                : "The terminal never syncs. All admin work stays on the terminal itself."}
            </Hint>
          </Field>

          <Field>
            <CheckRow $disabled={!lockApplies}>
              <input
                type="checkbox"
                checked={lockApplies && posAdminLocked}
                disabled={!lockApplies}
                onChange={(e) => setPosAdminLocked(e.target.checked)}
              />
              <span>Cashier-only POS</span>
            </CheckRow>
            <Hint>
              {lockApplies
                ? "Hides stock, suppliers and user management in the Electron app and stops it uploading product, user, supplier, arrival and settings changes. Sales and shifts still sync. Takes effect on the terminal within one sync cycle; unchecking it restores everything."
                : "Only applies to online stores — an offline store always keeps full local management."}
            </Hint>
          </Field>

          <Field>
            <Label>Manager password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={superAdminPassword}
              disabled={clearSuperAdminPassword}
              placeholder={
                store?.hasSuperAdminPassword ? "Set — type to replace" : "Not set"
              }
              onChange={(e) => setSuperAdminPassword(e.target.value)}
            />
            <Hint>
              Asked for on the terminal before sensitive actions, such as deleting a receipt. The
              terminal checks it offline, so it works for an offline-only store too. Leave blank to
              keep the current password; leave it unset and nothing is gated.
            </Hint>
            {store?.hasSuperAdminPassword && (
              <CheckRow>
                <input
                  type="checkbox"
                  checked={clearSuperAdminPassword}
                  onChange={(e) => {
                    setClearSuperAdminPassword(e.target.checked);
                    if (e.target.checked) setSuperAdminPassword("");
                  }}
                />
                <span>Remove the password (stops gating anything)</span>
              </CheckRow>
            )}
          </Field>

          {error && <ErrorMsg>{error}</ErrorMsg>}

          <FooterActions>
            <Btn type="button" onClick={onClose}>
              Cancel
            </Btn>
            <Btn type="submit" $primary disabled={saving}>
              {saving ? "Saving…" : isNew ? "Create" : "Save"}
            </Btn>
          </FooterActions>
        </form>
      </Modal>
    </Overlay>
  );
}
