import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { RefreshCw, Save } from "lucide-react";
import { siteConfig, SubscriptionPlanPrices, SubscriptionPayment } from "../../api/client";

const Page = styled.div`
  padding: 32px;
  max-width: 900px;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 32px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 28px;
  color: ${({ theme }) => theme.colors.text};
`;

const Subtitle = styled.p`
  margin: 6px 0 0;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 24px;

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div<{ $accent?: string }>`
  border: 2px solid ${({ $accent, theme }) => $accent ?? theme.colors.border};
  border-radius: 10px;
  padding: 24px;
  background: ${({ theme }) => theme.colors.surface};
`;

const PlanName = styled.div<{ $color?: string }>`
  font-size: 20px;
  font-weight: 700;
  color: ${({ $color, theme }) => $color ?? theme.colors.text};
  margin-bottom: 4px;
`;

const PlanDesc = styled.div`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 20px;
  line-height: 1.5;
`;

const Label = styled.label`
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 6px;
`;

const Input = styled.input`
  width: 100%;
  padding: 10px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  font-size: 15px;
  background: transparent;
  color: ${({ theme }) => theme.colors.text};
  box-sizing: border-box;
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
`;

const SaveBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  background: ${({ theme }) => theme.colors.primary};
  color: #fff;
  &:hover { opacity: 0.85; }
  &:disabled { opacity: 0.4; cursor: default; }
`;

const SuccessMsg = styled.div`
  color: #16a34a;
  font-size: 14px;
  margin-top: 12px;
`;

const ErrorMsg = styled.div`
  color: ${({ theme }) => theme.colors.error};
  font-size: 14px;
  margin-top: 12px;
`;

const Section = styled.div`
  margin-top: 40px;
`;

const SectionTitle = styled.h2`
  margin: 0 0 4px;
  font-size: 20px;
  color: ${({ theme }) => theme.colors.text};
`;

const Field = styled.div`
  margin-bottom: 18px;
`;

const FieldHint = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 6px;
  line-height: 1.5;
`;

const PLANS = [
  {
    key: "starter" as keyof SubscriptionPlanPrices,
    name: "START",
    desc: "Basic POS features for small stores. Monthly subscription.",
    color: "#16a34a",
    accent: "#bbf7d0",
  },
  {
    key: "pro" as keyof SubscriptionPlanPrices,
    name: "PRO",
    desc: "Full features — analytics, multi-terminal, invoice scanning. Monthly subscription.",
    color: "#2563eb",
    accent: "#bfdbfe",
  },
  {
    key: "vip" as keyof SubscriptionPlanPrices,
    name: "VIP",
    desc: "Perpetual license for clients who purchased the app outright. All features, no expiry.",
    color: "#7c3aed",
    accent: "#e9d5ff",
  },
];

export function SubscriptionPlansPage() {
  const [prices, setPrices] = useState<SubscriptionPlanPrices>({ starter: 0, pro: 0, vip: 0 });
  const [payment, setPayment] = useState<SubscriptionPayment>({
    qrPayload: "",
    paymentUrl: "",
    supportPhone: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      siteConfig.getSubscriptionPlans().then(setPrices),
      siteConfig.getSubscriptionPayment().then(setPayment),
    ])
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Prices and payment details are saved together — they are one page to the super admin, and
  // splitting the button would leave the POS dialog half-configured after a partial save.
  const handleSave = async () => {
    setSaving(true);
    setSuccess(false);
    setError(null);
    try {
      await siteConfig.setSubscriptionPlans(prices);
      await siteConfig.setSubscriptionPayment(payment);
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <Header>
        <div>
          <Title>Subscription Plans</Title>
          <Subtitle>Set monthly prices (UZS) for each plan. VIP is a one-time purchase price.</Subtitle>
        </div>
      </Header>

      {loading ? (
        <div style={{ display: "flex", gap: 8, color: "#6b7280" }}>
          <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} />
          Loading…
        </div>
      ) : (
        <>
          <Grid>
            {PLANS.map(({ key, name, desc, color, accent }) => (
              <Card key={key} $accent={accent}>
                <PlanName $color={color}>{name}</PlanName>
                <PlanDesc>{desc}</PlanDesc>
                <Label>
                  {key === "vip" ? "One-time price (UZS)" : "Monthly price (UZS)"}
                </Label>
                <Input
                  type="number"
                  step="1000"
                  value={prices[key]}
                  onChange={(e) =>
                    setPrices((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                  }
                  onFocus={(e) => e.target.select()}
                />
              </Card>
            ))}
          </Grid>

          <Section>
            <SectionTitle>Payment Details</SectionTitle>
            <Subtitle style={{ marginBottom: 24 }}>
              Shown on every POS login screen under the subscription button, so stores can pay
              without calling first.
            </Subtitle>

            <Card>
              <Field>
                <Label>Bank transfer QR payload</Label>
                <Input
                  value={payment.qrPayload}
                  placeholder="Paste the payload your bank app encodes in its transfer QR"
                  onChange={(e) => setPayment((p) => ({ ...p, qrPayload: e.target.value }))}
                />
                <FieldHint>
                  The terminal renders this into a QR itself, so the dialog still works with no
                  network. Leave empty to hide the QR.
                </FieldHint>
              </Field>

              <Field>
                <Label>Self-service payment link</Label>
                <Input
                  value={payment.paymentUrl}
                  placeholder="https://my.click.uz/services/pay?service_id=…&store={storeId}"
                  onChange={(e) => setPayment((p) => ({ ...p, paymentUrl: e.target.value }))}
                />
                <FieldHint>
                  Click, Payme or Paynet link, opened in the cashier's browser. Any{" "}
                  <code>{"{storeId}"}</code> in the URL is replaced with the paying store's ID.
                </FieldHint>
              </Field>

              <Field>
                <Label>Call centre phone</Label>
                <Input
                  value={payment.supportPhone}
                  placeholder="+998 90 123 45 67"
                  onChange={(e) => setPayment((p) => ({ ...p, supportPhone: e.target.value }))}
                />
                <FieldHint>
                  Shown next to the instruction to call after a bank transfer, since those are
                  renewed by hand.
                </FieldHint>
              </Field>
            </Card>
          </Section>

          <SaveBtn onClick={handleSave} disabled={saving} style={{ marginTop: 24 }}>
            <Save size={16} />
            {saving ? "Saving…" : "Save Changes"}
          </SaveBtn>

          {success && <SuccessMsg>Saved successfully.</SuccessMsg>}
          {error && <ErrorMsg>{error}</ErrorMsg>}
        </>
      )}
    </Page>
  );
}
