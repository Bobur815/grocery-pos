import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Modal } from "../../components/common/Modal";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { UzbekPhoneInput } from "../../components/common/UzbekPhoneInput";
import { useVirtualKeyboard } from "../../hooks/useVirtualKeyboard";
import {
  KeyboardToggle,
  KeyboardPanel,
  KEYBOARD_Z_ABOVE_MODAL,
} from "../../components/common/VirtualKeyboardControls";
import { isUzPhoneComplete } from "@shared/utils/phone";
import { convertUzbekText } from "@shared/utils/transliterator";
import { USER_ROLES, UserRole } from "@shared/constants";
import type { UserListItem } from "@shared/types";

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const FormTopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

const Select = styled.select`
  width: 100%;
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
`;

const Label = styled.label`
  display: block;
  margin-bottom: ${({ theme }) => theme.spacing.xs};
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.lg};
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 14px;
`;

const PinHint = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  margin-top: ${({ theme }) => theme.spacing.xs};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const PinClearButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.error};
  text-decoration: underline;
  cursor: pointer;
`;

interface UserFormModalProps {
  /** The user being edited, or undefined to create a new one. */
  user?: UserListItem & { hasPin?: boolean };
  onClose: () => void;
  onSaved: () => void;
}

type Field = "password" | "nameUz" | "nameRu" | "pin" | "phone";

/**
 * Add/edit a user, in a modal over the user list — the same shape the supplier management uses,
 * so an admin never loses the list to a separate page just to rename someone.
 *
 * Editing is deliberately partial: phone is the login identifier and is fixed once created, and an
 * empty password or PIN means "leave it as it is" rather than "clear it". The hash never reaches
 * the renderer, so there is nothing to prefill and no way to tell "unchanged" from "blank" other
 * than by that rule — clearing a PIN has its own explicit button.
 */
export function UserFormModal({ user, onClose, onSaved }: UserFormModalProps) {
  const { t } = useTranslation();
  const isEdit = Boolean(user);

  const [formData, setFormData] = useState({
    // Stored as the 9 local digits; the 998 prefix is added on submit.
    phone: user?.phone?.startsWith("998") ? user.phone.slice(3) : (user?.phone ?? ""),
    password: "",
    nameRu: user?.nameRu ?? "",
    nameUz: user?.nameUz ?? "",
    role: (user?.role ?? USER_ROLES.USER) as UserRole,
    pin: "",
  });
  const [hasPin, setHasPin] = useState(Boolean(user?.hasPin));
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const onlyPin = (value: string) => value.replace(/\D/g, "").slice(0, 4);

  // Auto-transliterate between Uzbek Latin and Cyrillic. The mirrored field is only overwritten
  // while it still matches the transliteration — once someone edits it by hand, it is left alone.
  const handleNameUzChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      nameUz: value,
      nameRu:
        prev.nameRu === "" || prev.nameRu === convertUzbekText(prev.nameUz)
          ? convertUzbekText(value)
          : prev.nameRu,
    }));
  };

  const handleNameRuChange = (value: string) => {
    setFormData((prev) => ({
      ...prev,
      nameRu: value,
      nameUz:
        prev.nameUz === "" || prev.nameUz === convertUzbekText(prev.nameRu)
          ? convertUzbekText(value)
          : prev.nameUz,
    }));
  };

  // The on-screen keyboard goes through the same handlers a physical keystroke does, so
  // transliteration, the digits-only PIN and the phone's 9-digit cap all still apply.
  const keyboard = useVirtualKeyboard<Field>((field, edit) => {
    if (field === "nameUz") return handleNameUzChange(edit(formData.nameUz));
    if (field === "nameRu") return handleNameRuChange(edit(formData.nameRu));
    if (field === "pin") {
      return setFormData((prev) => ({ ...prev, pin: onlyPin(edit(prev.pin)) }));
    }
    if (field === "phone") {
      return setFormData((prev) => ({
        ...prev,
        phone: edit(prev.phone).replace(/\D/g, "").slice(0, 9),
      }));
    }
    setFormData((prev) => ({ ...prev, password: edit(prev.password) }));
  });

  const handleChange = (field: "phone" | "password" | "role", value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleRemovePin = async () => {
    if (!user) return;
    setError("");
    try {
      // Explicit null — an empty field means "keep", so clearing has to be asked for.
      await window.electronAPI.users.update(user.id, { pin: null });
      setFormData((prev) => ({ ...prev, pin: "" }));
      setHasPin(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (user) {
        const updateData: Record<string, string | null> = {
          nameRu: formData.nameRu,
          nameUz: formData.nameUz,
          role: formData.role,
        };
        if (formData.password) updateData.password = formData.password;
        if (formData.pin) updateData.pin = formData.pin;

        await window.electronAPI.users.update(user.id, updateData);
      } else {
        if (!formData.password) {
          setError(t("users.passwordRequired"));
          setIsLoading(false);
          return;
        }

        await window.electronAPI.users.create({
          ...formData,
          pin: formData.pin || undefined,
          phone: "998" + formData.phone,
        });
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      title={isEdit ? t("users.editUser") : t("users.addUser")}
      onClose={onClose}
      width="500px"
    >
      <FormTopBar>
        <KeyboardToggle kb={keyboard} />
      </FormTopBar>

      <Form onSubmit={handleSubmit}>
        <UzbekPhoneInput
          label={t("users.phone")}
          valueDigits={formData.phone}
          onDigitsChange={(digits) => handleChange("phone", digits)}
          onFocus={keyboard.fieldProps("phone", { numeric: true }).onFocus}
          disabled={isEdit}
          autoFocus={!isEdit}
        />

        <Input
          label={isEdit ? t("users.newPassword") : t("users.password")}
          type="password"
          value={formData.password}
          onChange={(e) => handleChange("password", e.target.value)}
          {...keyboard.fieldProps("password")}
          required={!isEdit}
          placeholder={isEdit ? t("users.leaveBlankToKeep") : ""}
        />

        <Input
          label={t("users.nameUz")}
          value={formData.nameUz}
          onChange={(e) => handleNameUzChange(e.target.value)}
          {...keyboard.fieldProps("nameUz")}
          required
          autoFocus={isEdit}
        />

        <Input
          label={t("users.nameRu")}
          value={formData.nameRu}
          onChange={(e) => handleNameRuChange(e.target.value)}
          {...keyboard.fieldProps("nameRu")}
          required
        />

        <FormGroup>
          <Label>{t("users.role")}</Label>
          <Select
            value={formData.role}
            onChange={(e) => handleChange("role", e.target.value)}
          >
            <option value="USER">{t("users.cashier")}</option>
            <option value="ADMIN">{t("users.admin")}</option>
          </Select>
        </FormGroup>

        <FormGroup>
          <Input
            label={t("users.pin")}
            type="password"
            inputMode="numeric"
            value={formData.pin}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, pin: onlyPin(e.target.value) }))
            }
            {...keyboard.fieldProps("pin", { numeric: true })}
            placeholder={hasPin ? t("users.leaveBlankToKeep") : ""}
          />
          <PinHint>
            {hasPin ? t("users.pinSet") : t("users.pinHint")}
            {hasPin && (
              <PinClearButton type="button" onClick={handleRemovePin}>
                {t("users.removePin")}
              </PinClearButton>
            )}
          </PinHint>
        </FormGroup>

        {error && <ErrorMessage>{error}</ErrorMessage>}

        <Actions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={isLoading || (!isEdit && !isUzPhoneComplete(formData.phone))}
          >
            {isLoading ? t("common.saving") : t("common.save")}
          </Button>
        </Actions>
      </Form>

      <KeyboardPanel kb={keyboard} zIndex={KEYBOARD_Z_ABOVE_MODAL} />
    </Modal>
  );
}
