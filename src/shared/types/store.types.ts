export interface Store {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
  settings: StoreSettings | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoreSettings {
  taxRate?: number;
  receiptHeader?: string;
  receiptFooter?: string;
  currency?: string;
  logoUrl?: string;
}

export interface StoreCreateInput {
  name: string;
  address?: string;
  phone?: string;
  settings?: StoreSettings;
}

export interface StoreUpdateInput {
  name?: string;
  address?: string;
  phone?: string;
  active?: boolean;
  settings?: StoreSettings;
}

export interface StoreWithStats extends Store {
  usersCount: number;
  productsCount: number;
  salesCount: number;
  totalRevenue: number;
}

/**
 * Subscription status for this terminal's store, as shown on the POS login screen.
 *
 * `stale` marks a reply served from the local cache because the VPS was unreachable — the
 * numbers are the last ones seen, not necessarily the current ones.
 */
export interface StoreSubscription {
  plan: string | null;
  expiresAt: string | null;
  aiPlan: string;
  balanceUzs: number | null;
  payment: SubscriptionPaymentInfo;
  stale: boolean;
}

export interface SubscriptionPaymentInfo {
  /** Bank-transfer payload, already rendered to a QR image by the main process. */
  qrDataUrl: string | null;
  /** Self-service Click/Payme/Paynet link for this store, or "" when none is configured. */
  paymentUrl: string;
  supportPhone: string;
}
