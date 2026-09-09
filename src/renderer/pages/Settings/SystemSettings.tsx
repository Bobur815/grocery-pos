import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "../../components/common/Button";
import { Input } from "../../components/common/Input";
import { useToast } from "../../context/ToastContext";
import { useVirtualKeyboard } from "../../hooks/useVirtualKeyboard";
import {
  KeyboardToggle,
  KeyboardPanel,
} from "../../components/common/VirtualKeyboardControls";
import {
  SettingsPage,
  SettingsGrid,
  SpanAll,
  FieldGrid,
} from "../../components/common/SettingsLayout";

const Container = styled(SettingsPage)``;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.md};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
  padding-left: 25px;
`;

const BackButton = styled(Button)``;

const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text};
`;

const Section = styled.div`
  background-color: ${({ theme }) => theme.colors.surface};
  padding: ${({ theme }) => theme.spacing.lg};
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const SectionTitle = styled.h2`
  margin: 0 0 ${({ theme }) => theme.spacing.md};
  font-size: 18px;
  color: ${({ theme }) => theme.colors.text};
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.md};
  margin-top: ${({ theme }) => theme.spacing.md};
`;

const InfoText = styled.p`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  margin: 0;
`;

const PlanBadge = styled.span<{ $pro?: boolean }>`
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: ${({ $pro, theme }) =>
    $pro ? theme.colors.primary : theme.colors.border};
  color: ${({ $pro, theme }) => ($pro ? "#fff" : theme.colors.textSecondary)};
  margin-left: 8px;
  vertical-align: middle;
`;

const PlanCard = styled.div<{ $pro?: boolean }>`
  border: 1px solid
    ${({ $pro, theme }) => ($pro ? theme.colors.primary : theme.colors.border)};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => theme.spacing.md};
`;

const CheckRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  cursor: pointer;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
  user-select: none;
`;

const StatRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${({ theme }) => theme.spacing.sm} 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};

  &:last-child {
    border-bottom: none;
  }
`;

const StatLabel = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
`;

const StatValue = styled.span`
  font-weight: 600;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`;

export function SystemSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [settings, setSettings] = useState({
    storeName: "",
    storeAddress: "",
    storePhone: "",
    storeStir: "",
    taxRate: "0",
    taxRateAsDiscount: false,
    syncInterval: "5",
  });

  // On-screen keyboard for the store-information form. Only the text fields are wired; the
  // read-only connection details and the checkbox have nothing to type into.
  type Field = "storeName" | "storeAddress" | "storePhone" | "storeStir" | "taxRate";
  const keyboard = useVirtualKeyboard<Field>((field, edit) =>
    setSettings((prev) => ({ ...prev, [field]: edit(prev[field]) })),
  );

  const [terminalId, setTerminalId] = useState("");
  const [storeId, setStoreId] = useState("");

  const [syncStatus, setSyncStatus] = useState<{
    isSyncing: boolean;
    lastSyncTime: string | null;
  }>({ isSyncing: false, lastSyncTime: null });

  const [plan, setPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [balanceUzs, setBalanceUzs] = useState<number | null>(null);

  useEffect(() => {
    loadSettings();
    loadSyncStatus();
    loadPlan();
    loadTerminalId();
  }, []);

  const loadSettings = async () => {
    try {
      const allSettings = await window.electronAPI.settings.getAll();
      setSettings((prev) => ({
        ...prev,
        storeName: allSettings.store_name || "",
        storeAddress: allSettings.store_address || "",
        storePhone: allSettings.store_phone || "",
        storeStir: allSettings.store_stir || "",
        taxRate: allSettings.tax_rate || "0",
        taxRateAsDiscount: allSettings.tax_rate_as_discount === "true",
        syncInterval: allSettings.sync_interval || "5",
      }));
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  };

  const loadSyncStatus = async () => {
    try {
      const status = await window.electronAPI.sync.getStatus();
      setSyncStatus(
        status as { isSyncing: boolean; lastSyncTime: string | null },
      );
    } catch (error) {
      console.error("Failed to load sync status:", error);
    }
  };

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await window.electronAPI.settings.set("store_name", settings.storeName);
      await window.electronAPI.settings.set(
        "store_address",
        settings.storeAddress,
      );
      await window.electronAPI.settings.set("store_phone", settings.storePhone);
      await window.electronAPI.settings.set("store_stir", settings.storeStir);
      await window.electronAPI.settings.set("tax_rate", settings.taxRate);
      await window.electronAPI.settings.set("tax_rate_as_discount", settings.taxRateAsDiscount ? "true" : "false");
      showToast(t("common.saved"), "success");
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

  const loadTerminalId = async () => {
    try {
      const config = (await window.electronAPI.config.getLocalConfig()) as {
        terminalId?: string;
        storeId?: string;
      } | null;
      if (config) {
        setTerminalId(config.terminalId || "");
        setStoreId(config.storeId || "");
      }
    } catch (error) {
      console.error("Failed to load terminal id:", error);
    }
  };

  const loadPlan = async () => {
    setPlanLoading(true);
    try {
      const data = await window.electronAPI.receipt.getPlan();
      setPlan(data.plan);
      if (data.plan === "paid") {
        setBalanceUzs(
          typeof data.balance_uzs === "number" ? data.balance_uzs : null,
        );
      }
    } catch (error) {
      console.error("Failed to load plan:", error);
    } finally {
      setPlanLoading(false);
    }
  };

  return (
    <Container>
      <Header>
        <BackButton
          variant="secondary"
          size="small"
          onClick={() => navigate("/settings")}
        >
          <ArrowLeft size={20} />
        </BackButton>
        <Title>{t("settings.systemSettings")}</Title>
        <KeyboardToggle kb={keyboard} style={{ marginLeft: "auto" }} />
      </Header>

      {/* The store form is the wide one — it spans the grid and pairs its own fields two-up.
          Connection details and the AI panel are short and sit beside each other below it. */}
      <SettingsGrid>
      <SpanAll>
      <Section>
        <SectionTitle>{t("settings.storeInformation")}</SectionTitle>
        <Form onSubmit={handleSaveStore}>
          <FieldGrid>
            <Input
              label={t("settings.storeName")}
              value={settings.storeName}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, storeName: e.target.value }))
              }
              {...keyboard.fieldProps("storeName")}
            />
            <Input
              label={t("settings.storeAddress")}
              value={settings.storeAddress}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, storeAddress: e.target.value }))
              }
              {...keyboard.fieldProps("storeAddress")}
            />
            <Input
              label={t("settings.storePhone")}
              value={settings.storePhone}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, storePhone: e.target.value }))
              }
              {...keyboard.fieldProps("storePhone", { numeric: true })}
            />
            <Input
              label={t("settings.storeStir")}
              value={settings.storeStir}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, storeStir: e.target.value }))
              }
              {...keyboard.fieldProps("storeStir", { numeric: true })}
            />
            <Input
              label={t("settings.taxRate")}
              type="number"
              step="0.01"
              value={settings.taxRate}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, taxRate: e.target.value }))
              }
              {...keyboard.fieldProps("taxRate", { numeric: true })}
            />
          </FieldGrid>
          <CheckRow>
            <input
              type="checkbox"
              checked={settings.taxRateAsDiscount}
              onChange={(e) =>
                setSettings((prev) => ({ ...prev, taxRateAsDiscount: e.target.checked }))
              }
            />
            {t("settings.taxRateAsDiscount")}
          </CheckRow>
          <Actions>
            <Button type="submit">{t("common.save")}</Button>
          </Actions>
        </Form>
      </Section>
      </SpanAll>

      <Section>
        <SectionTitle>{t("settings.connection")}</SectionTitle>
        <Row>
          <div>
            <InfoText style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>
              {t("settings.storeId")}
            </InfoText>
            <StatValue style={{ fontSize: 16 }}>{storeId || "—"}</StatValue>
          </div>
          <div>
            <InfoText style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>
              {t("settings.terminalId")}
            </InfoText>
            <StatValue style={{ fontSize: 16 }}>{terminalId || "—"}</StatValue>
          </div>
        </Row>
        <InfoText style={{ marginTop: 8 }}>{t("settings.terminalIdHint")}</InfoText>
      </Section>

      <Section>
        <SectionTitle>
          {t("aiSettings.title")}
          {plan === "paid" && (
            <PlanBadge $pro>{t("aiSettings.proPlanBadge")}</PlanBadge>
          )}
          {plan === "free" && (
            <PlanBadge>{t("aiSettings.freePlanBadge")}</PlanBadge>
          )}
        </SectionTitle>

        {plan === "free" && (
          <PlanCard>
            <InfoText style={{ marginBottom: "8px" }}>
              {t("aiSettings.freePlanNote")}
            </InfoText>
            <InfoText style={{ color: "inherit" }}>
              {t("aiSettings.freePlanContact")}
            </InfoText>
          </PlanCard>
        )}

        {plan === "paid" && (
          <PlanCard $pro>
            <StatRow>
              <StatLabel>{t("aiSettings.creditBalance")}</StatLabel>
              <StatValue>
                {balanceUzs !== null
                  ? `${balanceUzs.toLocaleString("ru-UZ", { maximumFractionDigits: 0 })} so'm`
                  : "—"}
              </StatValue>
            </StatRow>
            <InfoText style={{ marginTop: "8px", fontSize: 12, opacity: 0.7 }}>
              {t("aiSettings.proPlanNote")}
            </InfoText>
          </PlanCard>
        )}

        <Actions style={{ marginTop: "12px" }}>
          <Button
            onClick={loadPlan}
            disabled={planLoading}
            style={{ display: "flex", alignItems: "center", gap: "6px" }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: planLoading ? "spin 1s linear infinite" : "none",
              }}
            />
            {t("aiSettings.refreshPlan")}
          </Button>
        </Actions>
      </Section>

      </SettingsGrid>

      <KeyboardPanel kb={keyboard} />
    </Container>
  );
}
