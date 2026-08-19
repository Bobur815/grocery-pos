import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Modal } from "@components/common/Modal";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import { Select } from "@components/common/Select";
import { useProducts } from "../../hooks/useProducts";
import { useToast } from "@context/ToastContext";
import { inventoryCounts, type InventoryCountScope } from "../../api/client";

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  justify-content: flex-end;

  @media (max-width: 640px) {
    flex-direction: column-reverse;
  }
`;

interface CreateInventoryCountModalProps {
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function CreateInventoryCountModal({
  onClose,
  onCreated,
}: CreateInventoryCountModalProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { categories, loadCategories } = useProducts();

  const [scope, setScope] = useState<InventoryCountScope>("FULL");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    if (scope === "CATEGORY" && !categoryId) return;

    setIsSaving(true);
    try {
      const created = await inventoryCounts.create({
        scope,
        ...(scope === "CATEGORY" ? { categoryId: Number(categoryId) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.success(t("inventoryCount.created"));
      onCreated(created.id);
    } catch (err) {
      // The server rejects a second open document by design — surface its reason.
      const message = err instanceof Error ? err.message : "";
      toast.error(
        message.toLowerCase().includes("already exists")
          ? t("inventoryCount.alreadyOpen")
          : t("inventoryCount.createError"),
      );
      setIsSaving(false);
    }
  };

  return (
    <Modal title={t("inventoryCount.create")} onClose={onClose}>
      <Form onSubmit={handleSubmit}>
        <Select
          label={t("inventoryCount.scope.label")}
          value={scope}
          onChange={(e) => setScope(e.target.value as InventoryCountScope)}
          options={[
            { value: "FULL", label: t("inventoryCount.scope.full") },
            { value: "CATEGORY", label: t("inventoryCount.scope.category") },
          ]}
        />

        {scope === "CATEGORY" && (
          <Select
            label={t("inventoryCount.form.category")}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            placeholder={t("inventoryCount.form.selectCategory")}
            options={categories.map((c) => ({
              value: String(c.id),
              label: i18n.language === "uz" ? c.nameUz : c.nameRu,
            }))}
            required
          />
        )}

        <Input
          label={t("inventoryCount.form.note")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("inventoryCount.form.notePlaceholder")}
          maxLength={500}
        />

        <Actions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isSaving || (scope === "CATEGORY" && !categoryId)}
          >
            {isSaving ? t("common.saving") : t("inventoryCount.form.submit")}
          </Button>
        </Actions>
      </Form>
    </Modal>
  );
}
