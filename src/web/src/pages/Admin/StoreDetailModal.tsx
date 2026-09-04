import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { X, RefreshCw } from "lucide-react";
import { stores, StoreRecord, StoreStats } from "../../api/client";

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
  max-width: 540px;
  padding: 24px;
  max-height: 90vh;
  overflow-y: auto;
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

const SectionTitle = styled.h3`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 20px 0 10px;
`;

const StatGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 20px;
`;

const StatCard = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 12px 16px;
`;

const StatLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 4px;
`;

const StatValue = styled.div`
  font-size: 20px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.text};
`;

const PlanCard = styled.div<{ $pro?: boolean }>`
  border: 2px solid
    ${({ $pro, theme }) => ($pro ? theme.colors.primary : theme.colors.border)};
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
`;

const PlanRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
`;

const PlanLabel = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text};
`;

const PlanBadge = styled.span<{ $pro?: boolean }>`
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 700;
  background: ${({ $pro, theme }) =>
    $pro ? theme.colors.primary : theme.colors.border};
  color: ${({ $pro, theme }) => ($pro ? "#fff" : theme.colors.textSecondary)};
`;

const PlanNote = styled.p`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0 0 12px;
  line-height: 1.5;
`;

const PlanToggleRow = styled.div`
  display: flex;
  gap: 8px;
`;

const PlanBtn = styled.button<{ $active?: boolean }>`
  flex: 1;
  padding: 8px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid
    ${({ $active, theme }) =>
      $active ? theme.colors.primary : theme.colors.border};
  background: ${({ $active, theme }) =>
    $active ? theme.colors.primary : "transparent"};
  color: ${({ $active }) => ($active ? "#fff" : "inherit")};
  &:hover {
    opacity: 0.85;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const ErrorMsg = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 13px;
  margin-top: 8px;
`;

interface Props {
  store: StoreRecord;
  onClose: () => void;
  onUpdated: () => void;
}

export function StoreDetailModal({ store, onClose, onUpdated }: Props) {
  const [stats, setStats] = useState<StoreStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // AI plan
  const [currentAiPlan, setCurrentAiPlan] = useState(store.aiPlan);
  const [savingAiPlan, setSavingAiPlan] = useState(false);
  const [aiPlanError, setAiPlanError] = useState<string | null>(null);

  // Subscription plan
  const [currentSubPlan, setCurrentSubPlan] = useState<string | null>(store.subscriptionPlan);
  const [subExpiresAt, setSubExpiresAt] = useState(
    store.subscriptionExpiresAt ? store.subscriptionExpiresAt.slice(0, 10) : ""
  );
  const [savingSub, setSavingSub] = useState(false);
  const [subError, setSubError] = useState<string | null>(null);

  // Credit top-up
  const [creditAmount, setCreditAmount] = useState("");
  const [addingCredit, setAddingCredit] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);

  const loadStats = () => {
    setLoadingStats(true);
    stores
      .getStats(store.id)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoadingStats(false));
  };

  useEffect(() => {
    setCurrentAiPlan(store.aiPlan);
    setCurrentSubPlan(store.subscriptionPlan);
    setSubExpiresAt(store.subscriptionExpiresAt ? store.subscriptionExpiresAt.slice(0, 10) : "");
    loadStats();
  }, [store]);

  const handleAiPlanChange = async (plan: "free" | "paid") => {
    if (plan === currentAiPlan) return;
    setSavingAiPlan(true);
    setAiPlanError(null);
    try {
      await stores.update(store.id, { aiPlan: plan });
      setCurrentAiPlan(plan);
      onUpdated();
    } catch (e) {
      setAiPlanError((e as Error).message);
    } finally {
      setSavingAiPlan(false);
    }
  };

  const handleSubPlanSave = async () => {
    if (!currentSubPlan) return;
    setSavingSub(true);
    setSubError(null);
    try {
      const expiresAt = currentSubPlan === "VIP"
        ? null
        : subExpiresAt
          ? new Date(subExpiresAt).toISOString()
          : null;
      await stores.update(store.id, {
        subscriptionPlan: currentSubPlan,
        subscriptionExpiresAt: expiresAt,
      });
      onUpdated();
    } catch (e) {
      setSubError((e as Error).message);
    } finally {
      setSavingSub(false);
    }
  };

  const handleAddCredit = async () => {
    const amount = parseFloat(creditAmount);
    if (!amount || amount <= 0) return;
    setAddingCredit(true);
    setCreditError(null);
    try {
      await stores.addCredits(store.id, amount);
      setCreditAmount("");
      loadStats();
      onUpdated();
    } catch (e) {
      setCreditError((e as Error).message);
    } finally {
      setAddingCredit(false);
    }
  };

  const revenue = stats?.stats.totalRevenue ?? 0;
  const balance = stats?.store.balance ?? 0;

  return (
    <Overlay onClick={(e) => e.target === e.currentTarget && onClose()}>
      <Modal>
        <ModalHeader>
          <div>
            <ModalTitle>{store.name}</ModalTitle>
            {store.address && (
              <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                {store.address}
              </div>
            )}
          </div>
          <CloseBtn onClick={onClose}>
            <X size={18} />
          </CloseBtn>
        </ModalHeader>

        {/* Stats */}
        <SectionTitle>Statistics</SectionTitle>
        {loadingStats ? (
          <div
            style={{ display: "flex", gap: 8, color: "#6b7280", fontSize: 14 }}
          >
            <RefreshCw
              size={14}
              style={{ animation: "spin 1s linear infinite" }}
            />{" "}
            Loading…
          </div>
        ) : (
          <StatGrid>
            <StatCard>
              <StatLabel>Total Sales</StatLabel>
              <StatValue>
                {stats?.stats.totalSales?.toLocaleString() ?? "—"}
              </StatValue>
            </StatCard>
            <StatCard>
              <StatLabel>Revenue (UZS)</StatLabel>
              <StatValue>
                {revenue
                  ? revenue.toLocaleString("ru-UZ", {
                      maximumFractionDigits: 0,
                    })
                  : "—"}
              </StatValue>
            </StatCard>
            <StatCard>
              <StatLabel>Products</StatLabel>
              <StatValue>{stats?.stats.productsCount ?? "—"}</StatValue>
            </StatCard>
            <StatCard>
              <StatLabel>Users</StatLabel>
              <StatValue>{stats?.stats.usersCount ?? "—"}</StatValue>
            </StatCard>
          </StatGrid>
        )}

        {/* Terminal mode — edited in the store form, shown here for reference */}
        <SectionTitle>Terminal Mode</SectionTitle>
        <PlanCard $pro={store.posAdminLocked}>
          <PlanRow>
            <PlanLabel>Mode</PlanLabel>
            <PlanBadge $pro={store.mode === "ONLINE"}>
              {store.mode === "ONLINE" ? "Online" : "Offline only"}
            </PlanBadge>
          </PlanRow>
          <PlanRow>
            <PlanLabel>Cashier-only POS</PlanLabel>
            <PlanBadge $pro={store.posAdminLocked}>
              {store.posAdminLocked ? "On" : "Off"}
            </PlanBadge>
          </PlanRow>
          <PlanNote>
            {store.mode === "OFFLINE_ONLY"
              ? "This store never syncs. All management stays on the terminal."
              : store.posAdminLocked
                ? "The Electron app is restricted to cashier operation; management happens here. It uploads only sales, shifts, heartbeats and logs."
                : "The Electron app still has full local management and uploads its own product, user, supplier, arrival and settings changes."}
          </PlanNote>
        </PlanCard>

        {/* Subscription Plan */}
        <SectionTitle>Subscription Plan</SectionTitle>
        <PlanCard $pro={!!currentSubPlan}>
          <PlanRow>
            <PlanLabel>Plan</PlanLabel>
            <PlanBadge $pro={!!currentSubPlan}>
              {currentSubPlan ?? "No Plan"}
            </PlanBadge>
          </PlanRow>
          <PlanToggleRow style={{ marginBottom: 10 }}>
            {(["STARTER", "PRO", "VIP"] as const).map((p) => (
              <PlanBtn
                key={p}
                $active={currentSubPlan === p}
                onClick={() => setCurrentSubPlan(p)}
                disabled={savingSub}
              >
                {p}
              </PlanBtn>
            ))}
          </PlanToggleRow>
          {currentSubPlan && currentSubPlan !== "VIP" && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>Expiry date</div>
              <input
                type="date"
                value={subExpiresAt}
                onChange={(e) => setSubExpiresAt(e.target.value)}
                style={{
                  padding: "7px 10px",
                  border: "1px solid #d1d5db",
                  borderRadius: 6,
                  fontSize: 14,
                  background: "transparent",
                  color: "inherit",
                  width: "100%",
                }}
              />
            </div>
          )}
          {currentSubPlan === "VIP" && (
            <PlanNote>VIP is a perpetual license — no expiry date.</PlanNote>
          )}
          <PlanBtn
            $active
            onClick={handleSubPlanSave}
            disabled={savingSub || !currentSubPlan}
            style={{ flex: "none", width: "100%" }}
          >
            {savingSub ? "Saving…" : "Save Subscription"}
          </PlanBtn>
          {subError && <ErrorMsg>{subError}</ErrorMsg>}
        </PlanCard>

        {/* AI Invoice Scanning Plan */}
        <SectionTitle>AI Invoice Scanning</SectionTitle>
        <PlanCard $pro={currentAiPlan === "paid"}>
          <PlanRow>
            <PlanLabel>AI Scan Tier</PlanLabel>
            <PlanBadge $pro={currentAiPlan === "paid"}>
              {currentAiPlan === "paid" ? "Pro" : "Free"}
            </PlanBadge>
          </PlanRow>

          {currentAiPlan === "free" ? (
            <PlanNote>
              Free tier uses PaddleOCR (open-source, $0/scan). Limited accuracy
              on complex Uzbekistan invoices. Upgrade to Pro for Claude Vision.
            </PlanNote>
          ) : (
            <PlanNote>
              Pro tier uses Claude Vision AI. Billed at{" "}
              <strong>$0.052 / scan</strong> (Anthropic cost + 30% margin).
              Accurate parsing of SoliqServis e-invoices with MXIK codes.
            </PlanNote>
          )}

          <PlanToggleRow>
            <PlanBtn
              $active={currentAiPlan === "free"}
              onClick={() => handleAiPlanChange("free")}
              disabled={savingAiPlan}
            >
              Free (PaddleOCR)
            </PlanBtn>
            <PlanBtn
              $active={currentAiPlan === "paid"}
              onClick={() => handleAiPlanChange("paid")}
              disabled={savingAiPlan}
            >
              Pro (Claude Vision)
            </PlanBtn>
          </PlanToggleRow>

          {aiPlanError && <ErrorMsg>{aiPlanError}</ErrorMsg>}
        </PlanCard>

        {/* Balance (AI credit top-up) */}
        <SectionTitle>AI Credit Balance</SectionTitle>
        <PlanCard>
          <PlanRow>
            <PlanLabel>Current Balance</PlanLabel>
            <PlanBadge $pro={balance > 0}>
              {balance.toLocaleString("ru-UZ", { maximumFractionDigits: 0 })} so'm
            </PlanBadge>
          </PlanRow>
          <PlanNote style={{ marginBottom: 12 }}>
            When a client transfers payment (card, cash, etc.), enter the
            amount in UZS to top up their credit balance.
          </PlanNote>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Amount in UZS (so'm)"
              value={creditAmount}
              onChange={(e) => setCreditAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCredit()}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid #d1d5db",
                borderRadius: 6,
                fontSize: 14,
                background: "transparent",
                color: "inherit",
              }}
            />
            <PlanBtn
              $active
              onClick={handleAddCredit}
              disabled={addingCredit || !creditAmount || parseFloat(creditAmount) <= 0}
              style={{ flex: "0 0 auto", padding: "8px 16px" }}
            >
              {addingCredit ? "Adding…" : "Add Credit"}
            </PlanBtn>
          </div>
          {creditError && <ErrorMsg style={{ marginTop: 6 }}>{creditError}</ErrorMsg>}
        </PlanCard>

        {/* Info */}
        <SectionTitle>Store Info</SectionTitle>
        <div style={{ fontSize: 14, color: "#6b7280", lineHeight: 1.8 }}>
          <div>
            <strong>ID:</strong> {store.id}
          </div>
          <div>
            <strong>Phone:</strong> {store.phone ?? "—"}
          </div>
          <div>
            <strong>Status:</strong> {store.active ? "Active" : "Inactive"}
          </div>
          <div>
            <strong>Created:</strong>{" "}
            {new Date(store.createdAt).toLocaleDateString()}
          </div>
        </div>
      </Modal>
    </Overlay>
  );
}
