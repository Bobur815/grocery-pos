import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { ArrowLeft, RefreshCw, Info, X } from "lucide-react";
import { Button } from "@components/common/Button";
import { Input } from "@components/common/Input";
import {
  settings as settingsApi,
  receipt as receiptApi,
  stores as storesApi,
  siteConfig as siteConfigApi,
  auth as authApi,
  type StoreRecord,
  type SubscriptionPlanPrices,
} from "../../api/client";
import { useNavigate } from "react-router-dom";
import { TopBar } from "./DevicesPage";

import {
  SettingsPage,
  SettingsGrid,
  SpanAll,
  FieldGrid,
} from "@components/common/SettingsLayout";

const Container = styled(SettingsPage)``;
const Title = styled.h1`
  margin: 0 0 ${({ theme }) => theme.spacing.lg};
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
const SuccessText = styled.p`
  color: ${({ theme }) => theme.colors.success};
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
const TariffRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;
const InfoButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
  &:hover { color: ${({ theme }) => theme.colors.primary}; }
`;
const SubBadge = styled.span<{ $plan?: string }>`
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: ${({ $plan, theme }) =>
    $plan === 'VIP' ? '#7c3aed' :
    $plan === 'PRO' ? theme.colors.primary :
    $plan === 'STARTER' ? '#16a34a' :
    theme.colors.border};
  color: ${({ $plan, theme }) => $plan ? '#fff' : theme.colors.textSecondary};
`;
const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
`;
const ModalBox = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius};
  box-shadow: ${({ theme }) => theme.shadows.lg};
  max-width: 440px;
  width: 90%;
  padding: ${({ theme }) => theme.spacing.lg};
`;
const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;
const ModalTitle = styled.h3`
  margin: 0;
  font-size: 16px;
  color: ${({ theme }) => theme.colors.text};
`;
const CloseBtn = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
`;
const PlanInfoCard = styled.div<{ $plan: string }>`
  border-left: 3px solid ${({ $plan, theme }) =>
    $plan === 'VIP' ? '#7c3aed' :
    $plan === 'PRO' ? theme.colors.primary :
    '#16a34a'};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  margin-bottom: ${({ theme }) => theme.spacing.sm};
  background: ${({ theme }) => theme.colors.background};
  border-radius: 0 ${({ theme }) => theme.borderRadius} ${({ theme }) => theme.borderRadius} 0;
`;
const PlanInfoName = styled.div`
  font-weight: 700;
  font-size: 13px;
  margin-bottom: 2px;
`;
const PlanInfoDesc = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const PlanInfoPrice = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.primary};
  margin-top: 2px;
  font-weight: 600;
`;
const BalanceValue = styled.span`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;
const BalanceLabel = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 4px;
`;

export function SystemSettings() {
  const { t } = useTranslation();

  const [storeSettings, setStoreSettings] = useState({
    storeName: "",
    storeAddress: "",
    storePhone: "",
    storeStir: "",
    taxRate: "0",
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );

  const [plan, setPlan] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [balanceUzs, setBalanceUzs] = useState<number | null>(null);

  const [storeRecord, setStoreRecord] = useState<StoreRecord | null>(null);
  const [subscriptionPrices, setSubscriptionPrices] = useState<SubscriptionPlanPrices | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [showTariffInfo, setShowTariffInfo] = useState(false);

  const navigate = useNavigate();
  useEffect(() => {
    loadSettings();
    loadPlan();
    loadStore();
  }, []);

  const loadSettings = async () => {
    try {
      const allSettings = await settingsApi.getAll();
      setStoreSettings({
        storeName: allSettings.store_name || "",
        storeAddress: allSettings.store_address || "",
        storePhone: allSettings.store_phone || "",
        storeStir: allSettings.store_stir || "",
        taxRate: allSettings.tax_rate || "0",
      });
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  };

  const loadPlan = async () => {
    setPlanLoading(true);
    try {
      const data = await receiptApi.getPlan();
      setPlan(data.plan);
      setBalanceUzs(
        data.plan === "paid" && typeof data.balance_uzs === "number"
          ? data.balance_uzs
          : null,
      );
    } catch (error) {
      console.error("Failed to load plan:", error);
    } finally {
      setPlanLoading(false);
    }
  };

  const loadStore = async () => {
    setStoreLoading(true);
    try {
      const profile = await authApi.getProfile() as { storeId: string | null };
      if (!profile.storeId) return;
      const [record, prices] = await Promise.all([
        storesApi.getById(profile.storeId),
        siteConfigApi.getSubscriptionPlans(),
      ]);
      setStoreRecord(record);
      setSubscriptionPrices(prices);
    } catch (error) {
      console.error("Failed to load store:", error);
    } finally {
      setStoreLoading(false);
    }
  };

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus("saving");
    try {
      await settingsApi.set("store_name", storeSettings.storeName);
      await settingsApi.set("store_address", storeSettings.storeAddress);
      await settingsApi.set("store_phone", storeSettings.storePhone);
      await settingsApi.set("store_stir", storeSettings.storeStir);
      await settingsApi.set("tax_rate", storeSettings.taxRate);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error) {
      console.error("Failed to save settings:", error);
      setSaveStatus("idle");
    }
  };

  return (
    <Container>
      <TopBar>
        <Button
          variant="secondary"
          size="small"
          onClick={() => navigate("/settings")}
        >
          <ArrowLeft size={20} />
        </Button>
        <Title>{t("settings.systemSettings")}</Title>
      </TopBar>

      {/* The store form is the wide one — it spans the grid and pairs its own fields two-up.
          The subscription, balance and terminal cards are short and sit beside each other. */}
      <SettingsGrid>
      <SpanAll>
      <Section>
        <SectionTitle>{t("settings.storeInformation")}</SectionTitle>
        <Form onSubmit={handleSaveStore}>
          <FieldGrid>
            <Input
              label={t("settings.storeName")}
              value={storeSettings.storeName}
              onChange={(e) =>
                setStoreSettings((prev) => ({
                  ...prev,
                  storeName: e.target.value,
                }))
              }
            />
            <Input
              label={t("settings.storeAddress")}
              value={storeSettings.storeAddress}
              onChange={(e) =>
                setStoreSettings((prev) => ({
                  ...prev,
                  storeAddress: e.target.value,
                }))
              }
            />
            <Input
              label={t("settings.storePhone")}
              value={storeSettings.storePhone}
              onChange={(e) =>
                setStoreSettings((prev) => ({
                  ...prev,
                  storePhone: e.target.value,
                }))
              }
            />
            <Input
              label={t("settings.storeStir")}
              value={storeSettings.storeStir}
              onChange={(e) =>
                setStoreSettings((prev) => ({
                  ...prev,
                  storeStir: e.target.value,
                }))
              }
            />
            <Input
              label={t("settings.taxRate")}
              type="number"
              step="0.01"
              value={storeSettings.taxRate}
              onChange={(e) =>
                setStoreSettings((prev) => ({
                  ...prev,
                  taxRate: e.target.value,
                }))
              }
            />
          </FieldGrid>
          <Actions>
            <Button type="submit" disabled={saveStatus === "saving"}>
              {saveStatus === "saving" ? t("common.saving") : t("common.save")}
            </Button>
            {saveStatus === "saved" && (
              <SuccessText>{t("common.saved")}</SuccessText>
            )}
          </Actions>
        </Form>
      </Section>
      </SpanAll>

      <Section>
        <SectionTitle>
          {t("subscription.title")}
          {storeRecord?.subscriptionPlan && (
            <SubBadge $plan={storeRecord.subscriptionPlan} style={{ marginLeft: 8 }}>
              {storeRecord.subscriptionPlan}
            </SubBadge>
          )}
          {!storeRecord?.subscriptionPlan && !storeLoading && (
            <SubBadge style={{ marginLeft: 8 }}>{t("subscription.noplan")}</SubBadge>
          )}
        </SectionTitle>

        <StatRow>
          <StatLabel>{t("subscription.title")}</StatLabel>
          <TariffRow>
            {storeRecord?.subscriptionPlan ? (
              <SubBadge $plan={storeRecord.subscriptionPlan}>
                {storeRecord.subscriptionPlan}
              </SubBadge>
            ) : (
              <StatValue>—</StatValue>
            )}
            <InfoButton type="button" onClick={() => setShowTariffInfo(true)} title={t("subscription.infoTitle")}>
              <Info size={16} />
            </InfoButton>
          </TariffRow>
        </StatRow>

        {storeRecord?.subscriptionPlan && storeRecord.subscriptionPlan !== 'VIP' && (
          <StatRow>
            <StatLabel>{t("subscription.expiresAt")}</StatLabel>
            <StatValue>
              {storeRecord.subscriptionExpiresAt
                ? new Date(storeRecord.subscriptionExpiresAt).toLocaleDateString()
                : "—"}
            </StatValue>
          </StatRow>
        )}

        {storeRecord?.subscriptionPlan === 'VIP' && (
          <StatRow>
            <StatLabel>{t("subscription.expiresAt")}</StatLabel>
            <StatValue>{t("subscription.perpetual")}</StatValue>
          </StatRow>
        )}
      </Section>

      <Section>
        <SectionTitle>{t("subscription.storeBalanceTitle")}</SectionTitle>
        <StatRow>
          <StatLabel>{t("subscription.storeBalance")}</StatLabel>
          <BalanceValue>
            {balanceUzs !== null
              ? `${balanceUzs.toLocaleString("ru-UZ", { maximumFractionDigits: 0 })} so'm`
              : "—"}
          </BalanceValue>
        </StatRow>
        <Actions style={{ marginTop: "8px" }}>
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

      {showTariffInfo && (
        <ModalOverlay onClick={() => setShowTariffInfo(false)}>
          <ModalBox onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>{t("subscription.infoTitle")}</ModalTitle>
              <CloseBtn onClick={() => setShowTariffInfo(false)}>
                <X size={18} />
              </CloseBtn>
            </ModalHeader>
            <PlanInfoCard $plan="STARTER">
              <PlanInfoName>{t("subscription.infoStarterTitle")}</PlanInfoName>
              <PlanInfoDesc>{t("subscription.infoStarterDesc")}</PlanInfoDesc>
              {subscriptionPrices && (
                <PlanInfoPrice>
                  {subscriptionPrices.starter.toLocaleString("ru-UZ")} {t("subscription.pricePerMonth")}
                </PlanInfoPrice>
              )}
            </PlanInfoCard>
            <PlanInfoCard $plan="PRO">
              <PlanInfoName>{t("subscription.infoProTitle")}</PlanInfoName>
              <PlanInfoDesc>{t("subscription.infoProDesc")}</PlanInfoDesc>
              {subscriptionPrices && (
                <PlanInfoPrice>
                  {subscriptionPrices.pro.toLocaleString("ru-UZ")} {t("subscription.pricePerMonth")}
                </PlanInfoPrice>
              )}
            </PlanInfoCard>
            <PlanInfoCard $plan="VIP">
              <PlanInfoName>{t("subscription.infoVipTitle")}</PlanInfoName>
              <PlanInfoDesc>{t("subscription.infoVipDesc")}</PlanInfoDesc>
              {subscriptionPrices && (
                <PlanInfoPrice>
                  {subscriptionPrices.vip.toLocaleString("ru-UZ")} {t("subscription.pricePerMonth")}
                </PlanInfoPrice>
              )}
            </PlanInfoCard>
          </ModalBox>
        </ModalOverlay>
      )}

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
            <InfoText style={{ fontSize: 12, opacity: 0.7 }}>
              {t("aiSettings.proPlanNote")}
            </InfoText>
          </PlanCard>
        )}
      </Section>
      </SettingsGrid>
    </Container>
  );
}
