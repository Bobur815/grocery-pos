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
  /**
   * Which store this is. The terminal knows its own storeId from LocalConfig, but the *name* only
   * exists on the server — and on a shop with more than one terminal, "whose subscription am I
   * looking at" is the first thing the dialog has to answer.
   */
  storeId: string | null;
  storeName: string | null;
  plan: string | null;
  expiresAt: string | null;
  aiPlan: string;
  balanceUzs: number | null;
  payment: SubscriptionPaymentInfo;
  /** True when this is a cached snapshot rather than a live read. `reason` says why. */
  stale: boolean;
  /**
   * Why the live read did not happen, when it did not.
   *
   * Without this a blank dialog is indistinguishable from a store with no plan, and the cashier —
   * or whoever they call — has nothing to act on. Each value maps to a different fix: sign in with
   * a password, check the connection, or call support.
   */
  reason?: SubscriptionFailureReason;
}

/** Why `subscription:get` fell back to the cache. */
export type SubscriptionFailureReason =
  /**
   * This terminal's store is OFFLINE_ONLY, and the vendor's server refuses `/auth/login` for such
   * a store (403 auth.errors.store_offline_only). So the terminal cannot obtain a credential at
   * all, and no amount of signing in will change that — the shop has to contact the vendor.
   * Distinct from 'no-credential' precisely because the advice is different.
   */
  | 'offline-only-store'
  /** No VPS token on this terminal — only a password login mints one, a PIN login cannot. */
  | 'no-credential'
  /** The server was not reachable, or did not answer in time. */
  | 'unreachable'
  /** It answered, but with an error — an expired token, or a server without this endpoint. */
  | 'server-error';

export interface SubscriptionPaymentInfo {
  /** Bank-transfer payload, already rendered to a QR image by the main process. */
  qrDataUrl: string | null;
  /** Self-service Click/Payme/Paynet link for this store, or "" when none is configured. */
  paymentUrl: string;
  supportPhone: string;
}
