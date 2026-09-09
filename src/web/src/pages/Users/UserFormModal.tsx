import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Modal } from "@components/common/Modal";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import { UzbekPhoneInput } from "@components/common/UzbekPhoneInput";
import { isUzPhoneComplete } from "@shared/utils/phone";
import { convertUzbekText } from "@shared/utils/transliterator";
import { USER_ROLES, UserRole } from "@shared/constants";
import { users as usersApi } from "../../api/client";
import type { UserListItem } from "@shared/types";

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
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

interface UserFormModalProps {
  /** The user being edited, or undefined to create a new one. */
  user?: UserListItem;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add/edit a user, in a modal over the user list — the same shape the POS terminal and supplier
 * management use, so an admin renaming a cashier keeps the list they were reading behind it.
 *
 * Editing is deliberately partial: phone is the login identifier and is fixed once created, and an
 * empty password means "leave it as it is" rather than "clear it" — the hash never reaches the
 * browser, so there is nothing to prefill and no way to tell "unchanged" from "blank" otherwise.
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
  });
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (field: "phone" | "password" | "role", value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  // Auto-transliterate between Uzbek Latin and Cyrillic. The mirrored field is only overwritten
  // while it still matches the transliteration — once someone edits it by hand, it is left alone.
  const handleNameUzChange = (value: string) =>
    setFormData((prev) => ({
      ...prev,
      nameUz: value,
      nameRu:
        prev.nameRu === "" || prev.nameRu === convertUzbekText(prev.nameUz)
          ? convertUzbekText(value)
          : prev.nameRu,
    }));

  const handleNameRuChange = (value: string) =>
    setFormData((prev) => ({
      ...prev,
      nameRu: value,
      nameUz:
        prev.nameUz === "" || prev.nameUz === convertUzbekText(prev.nameRu)
          ? convertUzbekText(value)
          : prev.nameUz,
    }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      if (user) {
        const updateData: Record<string, string> = {
          nameRu: formData.nameRu,
          nameUz: formData.nameUz,
          role: formData.role,
        };
        if (formData.password) updateData.password = formData.password;

        await usersApi.update(user.id, updateData);
      } else {
        if (!formData.password) {
          setError(t("users.passwordRequired"));
          setIsLoading(false);
          return;
        }

        await usersApi.create({ ...formData, phone: "998" + formData.phone });
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
      <Form onSubmit={handleSubmit}>
        <UzbekPhoneInput
          label={t("users.phone")}
          valueDigits={formData.phone}
          onDigitsChange={(digits) => handleChange("phone", digits)}
          disabled={isEdit}
        />

        <Input
          label={isEdit ? t("users.newPassword") : t("users.password")}
          type="password"
          value={formData.password}
          onChange={(e) => handleChange("password", e.target.value)}
          required={!isEdit}
          placeholder={isEdit ? t("users.leaveBlankToKeep") : ""}
        />

        <Input
          label={t("users.nameUz")}
          value={formData.nameUz}
          onChange={(e) => handleNameUzChange(e.target.value)}
          required
        />

        <Input
          label={t("users.nameRu")}
          value={formData.nameRu}
          onChange={(e) => handleNameRuChange(e.target.value)}
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
    </Modal>
  );
}
