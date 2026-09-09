import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button as CommonButton } from "../../components/common/Button";
import { PrintTagsModal } from "./PrintTagsModal";
import { generateId } from "../../utils/helpers";
import { useToast } from "../../context/ToastContext";
import { useVirtualKeyboard } from "../../hooks/useVirtualKeyboard";
import {
  KeyboardToggle,
  KeyboardPanel,
} from "../../components/common/VirtualKeyboardControls";

export interface PriceTagTemplate {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  elements: {
    name: boolean;
    price: boolean;
    unit: boolean;
    barcode: boolean;
    articleId: boolean;
    pluCode: boolean;
    productionDate: boolean;
    expiryDate: boolean;
    customText1: boolean;
    customText2: boolean;
  };
  customText1Value: string;
  customText2Value: string;
  fontSize: number;
  fontWeight: number;
}

const STORAGE_KEY = "price_tag_templates";

function createDefaultTemplate(): PriceTagTemplate {
  return {
    id: generateId(),
    name: "",
    widthMm: 40,
    heightMm: 30,
    elements: {
      name: true,
      price: true,
      unit: false,
      barcode: true,
      articleId: false,
      pluCode: false,
      productionDate: false,
      expiryDate: false,
      customText1: false,
      customText2: false,
    },
    customText1Value: "",
    customText2Value: "",
    fontSize: 12,
    fontWeight: 400,
  };
}

// --- Styled Components ---

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.lg};
`;

const TopBar = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  padding-left: 25px;
`;

const BackButton = styled(CommonButton)``;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Button = styled.button<{ $variant?: "primary" | "danger" | "secondary" }>`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border: none;
  border-radius: ${({ theme }) => theme.borderRadius};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;

  background-color: ${({ theme, $variant }) =>
    $variant === "danger"
      ? theme.colors.error
      : $variant === "secondary"
        ? theme.colors.border
        : theme.colors.primary};
  color: ${({ $variant, theme }) =>
    $variant === "secondary" ? theme.colors.text : "#fff"};

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ButtonGroup = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const PrinterRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  align-items: center;
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  &:hover {
    color: ${({ theme }) => theme.colors.primary};
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

// --- List View ---

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  overflow: hidden;
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

const Th = styled.th`
  text-align: left;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-bottom: 2px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 13px;
  font-weight: 600;
`;

const Td = styled.td`
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: ${({ theme }) => theme.spacing.xl};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 16px;
`;

// --- Editor View ---

const EditorLayout = styled.div`
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: ${({ theme }) => theme.spacing.lg};

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const EditorTopBar = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  flex-wrap: wrap;
`;

const FieldGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const FieldLabel = styled.label`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const FieldInput = styled.input`
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const FieldSelect = styled.select`
  padding: ${({ theme }) => theme.spacing.sm};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: ${({ theme }) => theme.borderRadius};
  background-color: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.text};
  font-size: 14px;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const Panel = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.sm};
  padding: ${({ theme }) => theme.spacing.md};
`;

const PanelTitle = styled.h3`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
`;

const CheckboxRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: 4px 0;
  cursor: pointer;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

const PreviewContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: ${({ theme }) => theme.colors.background};
  border-radius: ${({ theme }) => theme.borderRadius};
  min-height: 300px;
  padding: ${({ theme }) => theme.spacing.lg};
`;

const PreviewTag = styled.div<{
  $width: number;
  $height: number;
  $fontSize: number;
  $fontWeight: number;
}>`
  background: #fff;
  color: #000;
  border: 1px solid #ccc;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 4px;
  font-size: ${({ $fontSize }) => $fontSize}px;
  font-weight: ${({ $fontWeight }) => $fontWeight};
  /* Scale: 1mm ≈ 3px for preview */
  width: ${({ $width }) => $width * 3}px;
  height: ${({ $height }) => $height * 3}px;
`;

const PreviewLine = styled.div<{ $bold?: boolean; $small?: boolean }>`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  font-weight: ${({ $bold }) => ($bold ? 700 : "inherit")};
  font-size: ${({ $small }) => ($small ? "0.75em" : "inherit")};
`;

const SmallThumbnail = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 2px;
  padding: 2px;
  width: 60px;
  height: 40px;
  font-size: 7px;
  color: #333;
  overflow: hidden;
  text-align: center;
`;

// --- Component ---

export function PriceTags() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [templates, setTemplates] = useState<PriceTagTemplate[]>([]);
  const [editing, setEditing] = useState<PriceTagTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [printTemplateId, setPrintTemplateId] = useState<string | null>(null);

  // Printer settings
  const [printerName, setPrinterName] = useState("");
  const [availablePrinters, setAvailablePrinters] = useState<string[]>([]);
  const [printerSaving, setPrinterSaving] = useState(false);

  const loadAvailablePrinters = useCallback(async () => {
    try {
      const list = await window.electronAPI.printer.getAvailablePrinters();
      setAvailablePrinters(list);
    } catch {
      // silently ignore
    }
  }, []);

  // Load templates + printer settings
  useEffect(() => {
    (async () => {
      try {
        const raw = await window.electronAPI.settings.get(STORAGE_KEY);
        if (raw) {
          setTemplates(JSON.parse(raw));
        }
      } catch (err) {
        console.error("Failed to load price tag templates:", err);
      } finally {
        setLoading(false);
      }
    })();

    window.electronAPI.settings
      .get("label_printer_name")
      .then((v) => {
        if (v) setPrinterName(v);
      })
      .catch(() => {});

    loadAvailablePrinters();
  }, [loadAvailablePrinters]);

  const handleSavePrinter = async () => {
    setPrinterSaving(true);
    try {
      await window.electronAPI.settings.set("label_printer_name", printerName);
      toast.success(t("common.saved"));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setPrinterSaving(false);
    }
  };

  const saveTemplates = useCallback(async (updated: PriceTagTemplate[]) => {
    setTemplates(updated);
    await window.electronAPI.settings.set(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const handleCreate = () => {
    setEditing(createDefaultTemplate());
  };

  const handleEdit = (tpl: PriceTagTemplate) => {
    setEditing({ ...tpl, elements: { ...tpl.elements } });
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("priceTags.confirmDelete"))) return;
    await saveTemplates(templates.filter((t) => t.id !== id));
  };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return;
    const exists = templates.find((t) => t.id === editing.id);
    let updated: PriceTagTemplate[];
    if (exists) {
      updated = templates.map((t) => (t.id === editing.id ? editing : t));
    } else {
      updated = [...templates, editing];
    }
    await saveTemplates(updated);
    setEditing(null);
  };

  const handleBack = () => {
    setEditing(null);
  };

  const updateField = <K extends keyof PriceTagTemplate>(
    key: K,
    value: PriceTagTemplate[K],
  ) => {
    if (!editing) return;
    setEditing({ ...editing, [key]: value });
  };

  // On-screen keyboard for the template editor. It routes through updateField, so the numeric
  // dimensions come back as numbers and the text fields as strings, exactly as typing does.
  type Field = "name" | "customText1Value" | "customText2Value" | "widthMm" | "heightMm";
  const keyboard = useVirtualKeyboard<Field>((field, edit) => {
    if (!editing) return;
    const next = edit(String(editing[field] ?? ""));
    if (field === "widthMm" || field === "heightMm") {
      updateField(field, next === "" ? 0 : Number(next));
      return;
    }
    updateField(field, next);
  });

  const toggleElement = (key: keyof PriceTagTemplate["elements"]) => {
    if (!editing) return;
    setEditing({
      ...editing,
      elements: { ...editing.elements, [key]: !editing.elements[key] },
    });
  };

  if (loading) {
    return (
      <Container>
        <Title>{t("common.loading")}</Title>
      </Container>
    );
  }

  // --- Editor View ---
  if (editing) {
    const isNew = !templates.find((t) => t.id === editing.id);
    return (
      <Container>
        <EditorTopBar>
          <Button $variant="secondary" onClick={handleBack}>
            &larr; {t("priceTags.back")}
          </Button>
          <FieldGroup style={{ flex: 1 }}>
            <FieldInput
              placeholder={t("priceTags.templateName")}
              value={editing.name}
              onChange={(e) => updateField("name", e.target.value)}
              {...keyboard.fieldProps("name")}
            />
          </FieldGroup>
          <FieldGroup>
            <FieldLabel>{t("priceTags.width")}</FieldLabel>
            <FieldInput
              type="number"
              style={{ width: 70 }}
              value={editing.widthMm || ""}
              max={200}
              onChange={(e) =>
                updateField("widthMm", e.target.value === "" ? 0 : Number(e.target.value))
              }
              {...keyboard.fieldProps("widthMm", { numeric: true, clearOnFirstKey: true })}
            />
          </FieldGroup>
          <FieldGroup>
            <FieldLabel>{t("priceTags.height")}</FieldLabel>
            <FieldInput
              type="number"
              style={{ width: 70 }}
              value={editing.heightMm || ""}
              max={200}
              onChange={(e) =>
                updateField("heightMm", e.target.value === "" ? 0 : Number(e.target.value))
              }
              {...keyboard.fieldProps("heightMm", { numeric: true, clearOnFirstKey: true })}
            />
          </FieldGroup>
          <KeyboardToggle kb={keyboard} />
          <Button onClick={handleSave} disabled={!editing.name.trim()}>
            {t("common.save")}
          </Button>
        </EditorTopBar>

        <EditorLayout>
          {/* Left panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Panel>
              <PanelTitle>{t("priceTags.tagElements")}</PanelTitle>
              {(
                [
                  "name",
                  "price",
                  "unit",
                  "barcode",
                  "articleId",
                  "pluCode",
                  "productionDate",
                  "expiryDate",
                  "customText1",
                  "customText2",
                ] as (keyof PriceTagTemplate["elements"])[]
              ).map((key) => (
                <CheckboxRow key={key}>
                  <input
                    type="checkbox"
                    checked={editing.elements[key]}
                    onChange={() => toggleElement(key)}
                  />
                  {t(`priceTags.el_${key}`)}
                </CheckboxRow>
              ))}

              {editing.elements.customText1 && (
                <FieldGroup style={{ marginTop: 8 }}>
                  <FieldLabel>{t("priceTags.el_customText1")}</FieldLabel>
                  <FieldInput
                    value={editing.customText1Value}
                    onChange={(e) =>
                      updateField("customText1Value", e.target.value)
                    }
                    {...keyboard.fieldProps("customText1Value")}
                    placeholder={t("priceTags.customTextPlaceholder")}
                  />
                </FieldGroup>
              )}
              {editing.elements.customText2 && (
                <FieldGroup style={{ marginTop: 8 }}>
                  <FieldLabel>{t("priceTags.el_customText2")}</FieldLabel>
                  <FieldInput
                    {...keyboard.fieldProps("customText2Value")}
                    value={editing.customText2Value}
                    onChange={(e) =>
                      updateField("customText2Value", e.target.value)
                    }
                    placeholder={t("priceTags.customTextPlaceholder")}
                  />
                </FieldGroup>
              )}
            </Panel>

            <Panel>
              <PanelTitle>{t("priceTags.fontSettings")}</PanelTitle>
              <FieldGroup>
                <FieldLabel>{t("priceTags.fontSize")}</FieldLabel>
                <FieldSelect
                  value={editing.fontSize}
                  onChange={(e) =>
                    updateField("fontSize", Number(e.target.value))
                  }
                >
                  {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24].map((s) => (
                    <option key={s} value={s}>
                      {s}px
                    </option>
                  ))}
                </FieldSelect>
              </FieldGroup>
              <FieldGroup style={{ marginTop: 8 }}>
                <FieldLabel>{t("priceTags.fontWeight")}</FieldLabel>
                <FieldSelect
                  value={editing.fontWeight}
                  onChange={(e) =>
                    updateField("fontWeight", Number(e.target.value))
                  }
                >
                  {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </FieldSelect>
              </FieldGroup>
            </Panel>
          </div>

          {/* Right panel — Preview */}
          <Panel>
            <PanelTitle>{t("priceTags.preview")}</PanelTitle>
            <PreviewContainer>
              <TagPreview template={editing} />
            </PreviewContainer>
          </Panel>
        </EditorLayout>

        <KeyboardPanel kb={keyboard} />
      </Container>
    );
  }

  // --- List View ---
  const printTemplate = printTemplateId
    ? templates.find((t) => t.id === printTemplateId) || null
    : null;

  return (
    <Container>
      <TopBar>
        <Header>
          <BackButton variant="secondary" size="small" onClick={() => navigate("/settings")}>
            <ArrowLeft size={20} />
          </BackButton>
          <Title>{t("priceTags.title")}</Title>
        </Header>
        <Button onClick={handleCreate}>{t("priceTags.createTemplate")}</Button>
      </TopBar>

      {/* Printer selector */}
      <Panel>
        <PanelTitle>{t("scaleSettings.labelPrinterName")}</PanelTitle>
        <PrinterRow>
          <FieldSelect
            style={{ flex: 1 }}
            value={printerName}
            onChange={(e) => setPrinterName(e.target.value)}
          >
            <option value="">{t("printer.availablePrinters")}</option>
            {availablePrinters.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </FieldSelect>
          <IconButton
            type="button"
            onClick={loadAvailablePrinters}
            title={t("common.refresh")}
          >
            <RefreshCw size={16} />
          </IconButton>
          <Button onClick={handleSavePrinter} disabled={printerSaving}>
            {printerSaving ? t("common.saving") : t("common.save")}
          </Button>
        </PrinterRow>
      </Panel>

      {templates.length === 0 ? (
        <EmptyState>{t("priceTags.noTemplates")}</EmptyState>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>{t("priceTags.preview")}</Th>
              <Th>{t("priceTags.templateName")}</Th>
              <Th>{t("priceTags.dimensions")}</Th>
              <Th>{t("common.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tpl, idx) => (
              <tr key={tpl.id}>
                <Td>{idx + 1}</Td>
                <Td>
                  <SmallThumbnail>
                    {tpl.elements.name && <span>Abc</span>}
                    {tpl.elements.price && <span> $</span>}
                  </SmallThumbnail>
                </Td>
                <Td>{tpl.name}</Td>
                <Td>
                  {tpl.widthMm} x {tpl.heightMm} {t("priceTags.mm")}
                </Td>
                <Td>
                  <ButtonGroup>
                    <Button
                      $variant="secondary"
                      onClick={() => handleEdit(tpl)}
                    >
                      {t("common.edit")}
                    </Button>
                    <Button
                      $variant="primary"
                      onClick={() => setPrintTemplateId(tpl.id)}
                    >
                      {t("priceTags.print")}
                    </Button>
                    <Button
                      $variant="danger"
                      onClick={() => handleDelete(tpl.id)}
                    >
                      {t("common.delete")}
                    </Button>
                  </ButtonGroup>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {printTemplate && (
        <PrintTagsModal
          template={printTemplate}
          onClose={() => setPrintTemplateId(null)}
        />
      )}
    </Container>
  );
}

// --- Tag Preview Sub-component ---

function TagPreview({ template }: { template: PriceTagTemplate }) {
  const el = template.elements;

  return (
    <PreviewTag
      $width={template.widthMm}
      $height={template.heightMm}
      $fontSize={template.fontSize}
      $fontWeight={template.fontWeight}
    >
      {el.customText1 && template.customText1Value && (
        <PreviewLine $small>{template.customText1Value}</PreviewLine>
      )}

      {el.name && (
        <PreviewLine
          $bold
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Молоко Nestle 1л
        </PreviewLine>
      )}

      {el.unit && <PreviewLine $small>1.5 кг</PreviewLine>}

      {el.pluCode && (
        <PreviewLine $small>PLU: 00042</PreviewLine>
      )}

      {el.productionDate && (
        <PreviewLine $small>Произв.: 01.01.2025</PreviewLine>
      )}

      {el.expiryDate && (
        <PreviewLine $small>Годен до: 01.01.2026</PreviewLine>
      )}

      {(el.price || el.articleId) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
          }}
        >
          {el.articleId && (
            <span style={{ fontSize: "0.7em" }}>KOD: 00123</span>
          )}
          {el.price && (
            <span style={{ marginLeft: "auto" }}>4 667 so'm/кг</span>
          )}
        </div>
      )}

      {/* Barcode left + total right (weighted layout) */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 4, width: "100%" }}
      >
        {el.barcode && (
          <div
            style={{
              flex: 1,
              background: "#e8e8e8",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "3px 0",
            }}
          >
            <span
              style={{ fontSize: "0.55em", color: "#444", letterSpacing: 2 }}
            >
              ||| ||| |||
            </span>
          </div>
        )}
        {el.price && (
          <span
            style={{
              fontWeight: 700,
              fontSize: "0.85em",
              whiteSpace: "nowrap",
            }}
          >
            7 000 so'm
          </span>
        )}
      </div>

      {el.customText2 && template.customText2Value && (
        <PreviewLine $small>{template.customText2Value}</PreviewLine>
      )}
    </PreviewTag>
  );
}
