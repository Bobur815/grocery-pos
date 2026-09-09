import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { Modal } from "../../components/common/Modal";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { ConfirmDialog } from "../../components/common/ConfirmDialog";
import { VirtualKeyboard } from "../../components/common/VirtualKeyboard";
import { KEYBOARD_Z_ABOVE_MODAL } from "../../components/common/VirtualKeyboardControls";
import { KbToggle } from "../../components/common/SearchControls";
import { useSuppliers } from "../../hooks/useSuppliers";
import { useToast } from "../../context/ToastContext";
import { Supplier, SupplierPaymentType } from "@shared/types";
import { convertUzbekText } from "@shared/utils/transliterator";
import { UzbekPhoneInput } from "../../components/common/UzbekPhoneInput";
import { phoneToDigits, formatUzPhone } from "@shared/utils/phone";
import { Pencil, Trash2, Plus, ArrowLeft, CirclePlus, Keyboard, ChevronDown, ChevronUp } from "lucide-react";

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SupplierRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.background};
`;

const SupplierInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const SupplierName = styled.span`
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
`;

const SupplierMeta = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const RowActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const IconButton = styled.button<{ $variant?: "danger" }>`
  background: none;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 6px;
  cursor: pointer;
  color: ${({ theme, $variant }) =>
    $variant === "danger" ? theme.colors.error : theme.colors.textSecondary};
  display: flex;
  align-items: center;

  &:hover {
    background-color: ${({ theme, $variant }) =>
      $variant === "danger"
        ? theme.colors.error + "10"
        : theme.colors.background};
  }
`;

const TopBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const BackButton = styled.button`
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.primary};
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  font-size: 14px;

  &:hover {
    text-decoration: underline;
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  justify-content: flex-end;
  margin-top: ${({ theme }) => theme.spacing.sm};
`;

const EmptyMessage = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.label`
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
`;

const ToggleGroup = styled.div`
  display: flex;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
`;

const ToggleBtn = styled.button<{ $active: boolean }>`
  flex: 1;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.sm}`};
  border: none;
  cursor: pointer;
  font-size: 13px;
  background: ${({ $active, theme }) => $active ? theme.colors.primary : 'transparent'};
  color: ${({ $active }) => $active ? '#fff' : 'inherit'};
  transition: background 0.15s;
`;

const FormTopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.sm};
`;

interface SupplierManagementModalProps {
  onClose: () => void;
  onSupplierChanged: () => void;
  initialView?: "list" | "form";
  initialEditSupplier?: Supplier;
}

type View = "list" | "form";
type ActiveInput = 'nameUz' | 'nameRu' | 'address' | null;

export function SupplierManagementModal({
  onClose,
  onSupplierChanged,
  initialView,
  initialEditSupplier,
}: SupplierManagementModalProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const {
    suppliers,
    loadSuppliers,
    createSupplier,
    updateSupplier,
    deleteSupplier,
    isLoading,
  } = useSuppliers();

  const [view, setView] = useState<View>(initialView ?? "list");
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(initialEditSupplier ?? null);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(
    null,
  );
  const [formData, setFormData] = useState({
    nameRu: initialEditSupplier?.nameRu ?? "",
    nameUz: initialEditSupplier?.nameUz ?? "",
    phoneDigits: initialEditSupplier?.phone ? phoneToDigits(initialEditSupplier.phone) : "",
    balance: initialEditSupplier?.balance ?? 0,
    address: initialEditSupplier?.address ?? "",
    paymentType: (initialEditSupplier?.paymentType ?? "IMMEDIATE") as SupplierPaymentType,
  });

  // VirtualKeyboard state
  const [activeInput, setActiveInput] = useState<ActiveInput>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    loadSuppliers(true);
  }, [loadSuppliers]);

  const openCreateForm = () => {
    setEditingSupplier(null);
    setFormData({ nameRu: "", nameUz: "", phoneDigits: "", balance: 0, address: "", paymentType: "IMMEDIATE" });
    setView("form");
  };

  const openEditForm = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      nameRu: supplier.nameRu,
      nameUz: supplier.nameUz,
      phoneDigits: supplier.phone ? phoneToDigits(supplier.phone) : "",
      balance: supplier.balance || 0,
      address: supplier.address || "",
      paymentType: supplier.paymentType ?? "IMMEDIATE",
    });
    setView("form");
  };

  const handleNameUzChange = (value: string) => {
    setFormData((prev) => {
      const converted = convertUzbekText(value);
      return {
        ...prev,
        nameUz: value,
        nameRu:
          prev.nameRu === "" || prev.nameRu === convertUzbekText(prev.nameUz)
            ? converted
            : prev.nameRu,
      };
    });
  };

  const handleNameRuChange = (value: string) => {
    setFormData((prev) => {
      const converted = convertUzbekText(value);
      return {
        ...prev,
        nameRu: value,
        nameUz:
          prev.nameUz === "" || prev.nameUz === convertUzbekText(prev.nameRu)
            ? converted
            : prev.nameUz,
      };
    });
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleVirtualKey = (key: string) => {
    if (!activeInput) return;
    if (key === 'ENTER') return;
    if (key === 'BACKSPACE') {
      if (activeInput === 'nameUz') {
        handleNameUzChange(formData.nameUz.slice(0, -1));
      } else if (activeInput === 'nameRu') {
        handleNameRuChange(formData.nameRu.slice(0, -1));
      } else if (activeInput === 'address') {
        setFormData((prev) => ({ ...prev, address: prev.address.slice(0, -1) }));
      }
      return;
    }
    if (activeInput === 'nameUz') {
      handleNameUzChange(formData.nameUz + key);
    } else if (activeInput === 'nameRu') {
      handleNameRuChange(formData.nameRu + key);
    } else if (activeInput === 'address') {
      setFormData((prev) => ({ ...prev, address: prev.address + key }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const phone = formData.phoneDigits ? formatUzPhone(formData.phoneDigits) : undefined;
    const address = formData.address || undefined;

    let success;
    if (editingSupplier) {
      success = await updateSupplier(editingSupplier.id, {
        nameRu: formData.nameRu,
        nameUz: formData.nameUz,
        phone,
        address,
        balance: formData.balance ? Number(formData.balance) : 0,
        paymentType: formData.paymentType,
      });
      if (success) toast.success(t("suppliers.supplierUpdated"));
    } else {
      success = await createSupplier({
        nameRu: formData.nameRu,
        nameUz: formData.nameUz,
        phone,
        address,
        balance: formData.balance ? Number(formData.balance) : 0,
        paymentType: formData.paymentType,
      });
      if (success) toast.success(t("suppliers.supplierCreated"));
    }

    if (success) {
      onSupplierChanged();
      setView("list");
    }
  };

  const handleDelete = async () => {
    if (!supplierToDelete) return;
    const success = await deleteSupplier(supplierToDelete.id);
    if (success) {
      toast.success(t("suppliers.supplierDeleted"));
      onSupplierChanged();
      setSupplierToDelete(null);
    }
  };

  const getSupplierName = (supplier: Supplier) =>
    i18n.language === "uz" ? supplier.nameUz : supplier.nameRu;

  const title =
    view === "form"
      ? editingSupplier
        ? t("suppliers.editSupplier")
        : t("suppliers.addSupplier")
      : t("suppliers.title");

  return (
    <>
      <Modal title={title} onClose={onClose} width="500px">
        {view === "list" ? (
          <>
            <TopBar>
              <div />
              <Button size="small" onClick={openCreateForm}>
                <CirclePlus size={24} /> {t("suppliers.addSupplier")}
              </Button>
            </TopBar>
            <List>
              {suppliers.length === 0 ? (
                <EmptyMessage>{t("suppliers.noSuppliers")}</EmptyMessage>
              ) : (
                suppliers.map((supplier) => (
                  <SupplierRow key={supplier.id}>
                    <SupplierInfo>
                      <SupplierName>{getSupplierName(supplier)}</SupplierName>
                      {supplier.phone && (
                        <SupplierMeta>{supplier.phone}</SupplierMeta>
                      )}
                    </SupplierInfo>
                    <RowActions>
                      <IconButton onClick={() => openEditForm(supplier)}>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton
                        $variant="danger"
                        onClick={() => setSupplierToDelete(supplier)}
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </RowActions>
                  </SupplierRow>
                ))
              )}
            </List>
          </>
        ) : (
          <>
            <FormTopBar>
              <BackButton onClick={() => setView("list")}>
                <ArrowLeft size={14} /> {t("suppliers.title")}
              </BackButton>
              <KbToggle
                type="button"
                tabIndex={-1}
                $active={keyboardOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setKeyboardOpen((prev) => !prev)}
              >
                <Keyboard size={18} />
                {keyboardOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </KbToggle>
            </FormTopBar>
            <Form onSubmit={handleSubmit}>
              <Input
                label={t("suppliers.nameUz")}
                value={formData.nameUz}
                onChange={(e) => handleNameUzChange(e.target.value)}
                onFocus={() => setActiveInput('nameUz')}
                required
                autoFocus
              />
              <Input
                label={t("suppliers.nameRu")}
                value={formData.nameRu}
                onChange={(e) => handleNameRuChange(e.target.value)}
                onFocus={() => setActiveInput('nameRu')}
                required
              />
              <UzbekPhoneInput
                label={t("suppliers.phone")}
                valueDigits={formData.phoneDigits}
                onDigitsChange={(digits) =>
                  setFormData((prev) => ({ ...prev, phoneDigits: digits }))
                }
                autoFocus
              />
              {!editingSupplier && (
                <Input
                  label={t("suppliers.balance")}
                  value={formData.balance}
                  onChange={(e) => handleChange('balance', e.target.value)}
                  placeholder="0.00"
                  type="number"
                />
              )}
              <Input
                label={t("suppliers.address")}
                value={formData.address}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, address: e.target.value }))
                }
                onFocus={() => setActiveInput('address')}
              />
              <FormGroup>
                <Label>{t("suppliers.paymentType")}</Label>
                <ToggleGroup>
                  <ToggleBtn
                    type="button"
                    $active={formData.paymentType === "IMMEDIATE"}
                    onClick={() => setFormData((prev) => ({ ...prev, paymentType: "IMMEDIATE" }))}
                  >
                    {t("suppliers.paymentTypeImmediate")}
                  </ToggleBtn>
                  <ToggleBtn
                    type="button"
                    $active={formData.paymentType === "INSTALLMENT"}
                    onClick={() => setFormData((prev) => ({ ...prev, paymentType: "INSTALLMENT" }))}
                  >
                    {t("suppliers.paymentTypeInstallment")}
                  </ToggleBtn>
                </ToggleGroup>
              </FormGroup>
              <Actions>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setView("list")}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading || !formData.nameRu || !formData.nameUz}
                >
                  {isLoading ? t("common.saving") : t("common.save")}
                </Button>
              </Actions>
            </Form>
          </>
        )}
      </Modal>

      {supplierToDelete && (
        <ConfirmDialog
          title={t("common.delete")}
          message={t("suppliers.confirmDelete")}
          confirmLabel={t("common.delete")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setSupplierToDelete(null)}
        />
      )}

      {keyboardOpen && view === "form" && (
        <VirtualKeyboard
          fixed
          // Without this the panel sits at its default z-index 200, underneath the Modal's
          // full-screen overlay at 1000 — visible only as a darkened strip, and unclickable.
          zIndex={KEYBOARD_Z_ABOVE_MODAL}
          onKeyPress={handleVirtualKey}
          onClose={() => setKeyboardOpen(false)}
        />
      )}
    </>
  );
}
