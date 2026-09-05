import axios from "axios";
import type { CatalogEntry, MxikGroup } from "@shared/types";
import {
  mapPackageNames,
  pickSingleUnitPackage,
  findBarcodeMatch,
  type MxikPackage,
} from "@shared/utils";

export interface DeviceSession {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  deviceName: string | null;
  createdAt: string;
  isCurrent: boolean;
  isRevoked: boolean;
}

const baseURL = import.meta.env.VITE_API_URL ?? "/api";

export const axiosInstance = axios.create({ baseURL });

// Request interceptor: inject JWT and language
axiosInstance.interceptors.request.use((config) => {
  // Lazy-import to avoid circular deps; read directly from localStorage
  const raw = localStorage.getItem("auth-storage");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const token: string | undefined = parsed?.state?.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // ignore
    }
  }
  const lang = localStorage.getItem("language") ?? "ru";
  config.headers["Accept-Language"] = lang;
  return config;
});

// Response interceptor: 401 → logout
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth state
      localStorage.removeItem("auth-storage");
      window.location.href = "/web/login";
    }
    return Promise.reject(
      error instanceof Error
        ? error
        : new Error(error.response?.data?.message ?? String(error)),
    );
  },
);

// ─── Auth ────────────────────────────────────────────────────────────────────

export const auth = {
  login: async (phone: string, password: string, storeId?: string) => {
    const body: Record<string, string> = { phone, password };
    if (storeId) body.storeId = storeId;
    const { data } = await axiosInstance.post("/auth/login", body);
    return data as { token: string; user: unknown };
  },
  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout");
    } catch {
      /* ignore */
    }
  },
  getProfile: async () => {
    const { data } = await axiosInstance.get("/auth/profile");
    return data;
  },
  changePassword: async (currentPassword: string, newPassword: string) => {
    const { data } = await axiosInstance.post("/auth/change-password", {
      currentPassword,
      newPassword,
    });
    return data;
  },
  getSessions: async (): Promise<DeviceSession[]> => {
    const { data } = await axiosInstance.get("/auth/sessions");
    return data;
  },
  revokeSession: async (sessionId: string) => {
    const { data } = await axiosInstance.delete(`/auth/sessions/${sessionId}`);
    return data;
  },
  revokeOtherSessions: async () => {
    const { data } = await axiosInstance.delete("/auth/sessions/others");
    return data;
  },
  nameDevice: async (ipAddress: string, name: string) => {
    const { data } = await axiosInstance.patch("/auth/sessions/device-name", { ipAddress, name });
    return data;
  },
};

// ─── Products ────────────────────────────────────────────────────────────────

export const products = {
  getAll: async (filters?: Record<string, unknown>) => {
    const { data } = await axiosInstance.get("/products", { params: filters });
    return data;
  },
  getById: async (id: string, byDbId = false) => {
    const { data } = await axiosInstance.get(`/products/${id}`, {
      params: byDbId ? { byDbId: "true" } : undefined,
    });
    return data;
  },
  getByBarcode: async (barcode: string) => {
    const { data } = await axiosInstance.get(`/products/barcode/${barcode}`);
    return data;
  },
  findByInternalCode: async (internalCode: string) => {
    const { data } = await axiosInstance.get(
      `/products/internal-code/${internalCode}`,
    );
    return data;
  },
  getNextInternalCode: async (): Promise<string> => {
    const { data } = await axiosInstance.get('/products/next-internal-code');
    return data;
  },
  create: async (productData: unknown) => {
    const { data } = await axiosInstance.post("/products", productData);
    return data;
  },
  update: async (id: string, productData: unknown) => {
    const { data } = await axiosInstance.patch(`/products/${id}`, productData);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await axiosInstance.delete(`/products/${id}`);
    return data;
  },
  search: async (query: string) => {
    const { data } = await axiosInstance.get("/products", {
      params: { query },
    });
    return data;
  },
  getTopSelling: async (limit?: number) => {
    const { data } = await axiosInstance.get("/products/top-selling", {
      params: { limit },
    });
    return data;
  },
  getAnalytics: async (
    productId: number,
    startDate?: string,
    endDate?: string,
  ) => {
    const { data } = await axiosInstance.get(
      `/products/${productId}/analytics`,
      {
        params: { startDate, endDate },
      },
    );
    return data;
  },
};

// ─── Categories ──────────────────────────────────────────────────────────────

export const categories = {
  getAll: async () => {
    const { data } = await axiosInstance.get("/categories");
    return data;
  },
  create: async (categoryData: unknown) => {
    const { data } = await axiosInstance.post("/categories", categoryData);
    return data;
  },
  update: async (id: string, categoryData: unknown) => {
    const { data } = await axiosInstance.put(`/categories/${id}`, categoryData);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await axiosInstance.delete(`/categories/${id}`);
    return data;
  },
};

// ─── Inventory ───────────────────────────────────────────────────────────────

export const inventory = {
  createArrival: async (arrivalData: unknown) => {
    const { data } = await axiosInstance.post(
      "/inventory/arrivals",
      arrivalData,
    );
    return data;
  },
  getArrivals: async (filters?: { productId?: string }) => {
    const { data } = await axiosInstance.get("/inventory/arrivals", {
      params: filters,
    });
    return data;
  },
  updateArrival: async (id: string, payload: { quantity?: number; cost?: number; notes?: string }) => {
    const { data } = await axiosInstance.patch(`/inventory/arrivals/${id}`, payload);
    return data;
  },
  getLowStock: async () => {
    const { data } = await axiosInstance.get("/inventory/low-stock");
    return data;
  },
};

// ─── Inventarizatsiya (stocktake) ────────────────────────────────────────────

export type InventoryCountStatus =
  | "DRAFT"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type InventoryCountScope = "FULL" | "CATEGORY" | "CUSTOM";

/** Row shape returned by the list endpoint (no items). */
export interface InventoryCountSummary {
  id: string;
  number: number;
  status: InventoryCountStatus;
  scope: InventoryCountScope;
  note: string | null;
  createdByName: string;
  createdAt: string;
  completedAt: string | null;
  totalItems: number;
  countedItems: number;
  totalDifference: string;
  totalValueDiff: string;
  /** True when completion zeroed the uncounted lines. */
  wroteOffUncounted: boolean;
  writtenOffItems: number;
  /** Cost value of the write-off alone — a subset of totalValueDiff. */
  writeOffValue: string;
}

export interface InventoryCountItem {
  id: string;
  productId: number;
  productName: string;
  productNameUz: string;
  barcode: string;
  unit: string;
  expectedQty: string;
  cost: string | null;
  countedQty: string | null;
  difference: string | null;
  counted: boolean;
  /** Zeroed by a write-off rather than physically counted (counted stays false). */
  writtenOff: boolean;
}

export interface InventoryCountDetail extends InventoryCountSummary {
  storeId: string;
  categoryId: number | null;
  completedById: string | null;
  updatedAt: string;
  items: InventoryCountItem[];
}

export interface InventoryCountListResponse {
  rows: InventoryCountSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Returned by the per-line endpoints — only the touched line plus progress counters. */
export interface InventoryCountProgress {
  item: InventoryCountItem;
  countedItems: number;
  totalItems: number;
  status: InventoryCountStatus;
}

export const inventoryCounts = {
  list: async (params?: {
    search?: string;
    status?: InventoryCountStatus;
    page?: number;
    limit?: number;
  }): Promise<InventoryCountListResponse> => {
    const { data } = await axiosInstance.get("/inventory-counts", { params });
    return data;
  },
  get: async (id: string): Promise<InventoryCountDetail> => {
    const { data } = await axiosInstance.get(`/inventory-counts/${id}`);
    return data;
  },
  create: async (payload: {
    scope?: InventoryCountScope;
    categoryId?: number;
    note?: string;
  }): Promise<{ id: string; number: number }> => {
    const { data } = await axiosInstance.post("/inventory-counts", payload);
    return data;
  },
  setItem: async (
    id: string,
    itemId: string,
    countedQty: number,
  ): Promise<InventoryCountProgress> => {
    const { data } = await axiosInstance.patch(
      `/inventory-counts/${id}/items/${itemId}`,
      { countedQty },
    );
    return data;
  },
  scan: async (
    id: string,
    barcode: string,
    qty = 1,
  ): Promise<InventoryCountProgress> => {
    const { data } = await axiosInstance.post(`/inventory-counts/${id}/scan`, {
      barcode,
      qty,
    });
    return data;
  },
  complete: async (
    id: string,
    payload: {
      /** Write off EVERY uncounted line. Ignored when writeOffItemIds is present. */
      writeOffUncounted?: boolean;
      /** Write off only these item ids — an empty array writes nothing off. */
      writeOffItemIds?: string[];
    } = {},
  ): Promise<InventoryCountSummary> => {
    const { data } = await axiosInstance.post(
      `/inventory-counts/${id}/complete`,
      payload,
    );
    return data;
  },
  cancel: async (id: string): Promise<InventoryCountSummary> => {
    const { data } = await axiosInstance.post(`/inventory-counts/${id}/cancel`);
    return data;
  },
};

// ─── Suppliers ───────────────────────────────────────────────────────────────

export const suppliers = {
  getAll: async (includeInactive?: boolean) => {
    const { data } = await axiosInstance.get("/suppliers", {
      params: { includeInactive },
    });
    return data;
  },
  getById: async (id: string) => {
    const { data } = await axiosInstance.get(`/suppliers/${id}`);
    return data;
  },
  create: async (supplierData: unknown) => {
    const { data } = await axiosInstance.post("/suppliers", supplierData);
    return data;
  },
  update: async (id: string, supplierData: unknown) => {
    const { data } = await axiosInstance.patch(`/suppliers/${id}`, supplierData);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await axiosInstance.delete(`/suppliers/${id}`);
    return data;
  },
  getTransactions: async (filters?: unknown) => {
    const { data } = await axiosInstance.get("/suppliers/transactions", {
      params: filters as Record<string, unknown>,
    });
    return data;
  },
  createTransaction: async (transactionData: unknown) => {
    const { data } = await axiosInstance.post(
      "/suppliers/transactions",
      transactionData,
    );
    return data;
  },
  updateTransaction: async (id: string, transactionData: unknown) => {
    const { data } = await axiosInstance.put(
      `/suppliers/transactions/${id}`,
      transactionData,
    );
    return data;
  },
  deleteTransaction: async (id: string) => {
    const { data } = await axiosInstance.delete(
      `/suppliers/transactions/${id}`,
    );
    return data;
  },
  getBalance: async (supplierId: string) => {
    const { data } = await axiosInstance.get(
      `/suppliers/${supplierId}/balance`,
    );
    return data;
  },
  recordPayment: async (paymentData: unknown) => {
    const { data } = await axiosInstance.post(
      "/suppliers/payments",
      paymentData,
    );
    return data;
  },
};

// ─── Sales ───────────────────────────────────────────────────────────────────

export const sales = {
  getAll: async (filters?: { startDate?: string; endDate?: string }) => {
    const { data } = await axiosInstance.get("/sales", { params: filters });
    return data;
  },
  getById: async (id: string) => {
    const { data } = await axiosInstance.get(`/sales/${id}`);
    return data;
  },
  create: async (saleData: unknown) => {
    const { data } = await axiosInstance.post("/sales", saleData);
    return data;
  },
  update: async (id: string, saleData: unknown) => {
    const { data } = await axiosInstance.put(`/sales/${id}`, saleData);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await axiosInstance.delete(`/sales/${id}`);
    return data;
  },
  getTodaySummary: async () => {
    const { data } = await axiosInstance.get("/sales/today/summary");
    return data;
  },
};

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = {
  getAll: async () => {
    const { data } = await axiosInstance.get("/users");
    return data;
  },
  getById: async (id: string) => {
    const { data } = await axiosInstance.get(`/users/${id}`);
    return data;
  },
  create: async (userData: unknown) => {
    const { data } = await axiosInstance.post("/users", userData);
    return data;
  },
  update: async (id: string, userData: unknown) => {
    const { data } = await axiosInstance.patch(`/users/${id}`, userData);
    return data;
  },
  delete: async (id: string) => {
    const { data } = await axiosInstance.delete(`/users/${id}`);
    return data;
  },
};

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = {
  getAll: async () => {
    const { data } = await axiosInstance.get("/settings");
    return data;
  },
  get: async (key: string) => {
    const { data } = await axiosInstance.get(`/settings/${key}`);
    return data?.value ?? data;
  },
  set: async (key: string, value: string) => {
    const { data } = await axiosInstance.put(`/settings/${key}`, { value });
    return data;
  },
};

// ─── Receipt (AI OCR) ────────────────────────────────────────────────────────

export const receipt = {
  scan: async (imageData: string, mimeType?: string) => {
    const { data } = await axiosInstance.post("/invoice/scan", {
      imageBase64: imageData,
      mimeType,
    });
    return data;
  },
  matchProducts: async (items: unknown[]) => {
    const { data } = await axiosInstance.post("/invoice/match-products", {
      items,
    });
    return data;
  },
  getPlan: async (): Promise<{ plan: string; balance_uzs: number | null }> => {
    const { data } = await axiosInstance.get("/invoice/plan");
    return data;
  },
};

// ─── Stores (Super Admin) ─────────────────────────────────────────────────────

export type StoreMode = "OFFLINE_ONLY" | "ONLINE";

export interface StoreRecord {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  active: boolean;
  aiPlan: string;
  balance: number;
  subscriptionPlan: string | null;
  subscriptionExpiresAt: string | null;
  scheduledDeleteAt: string | null;
  mode: StoreMode;
  posAdminLocked: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { users: number; products: number; sales: number; terminalHeartbeats: number };
}

export interface StoreStats {
  store: StoreRecord;
  stats: {
    totalRevenue: number;
    totalSales: number;
    productsCount: number;
    usersCount: number;
  };
}

export const stores = {
  getAll: async (): Promise<StoreRecord[]> => {
    const { data } = await axiosInstance.get("/stores");
    return data;
  },
  getById: async (id: string): Promise<StoreRecord> => {
    const { data } = await axiosInstance.get(`/stores/${id}`);
    return data;
  },
  getStats: async (id: string): Promise<StoreStats> => {
    const { data } = await axiosInstance.get(`/stores/${id}/stats`);
    return data;
  },
  create: async (payload: {
    name: string;
    address?: string;
    phone?: string;
    mode?: StoreMode;
    posAdminLocked?: boolean;
  }): Promise<StoreRecord> => {
    const { data } = await axiosInstance.post("/stores", payload);
    return data;
  },
  update: async (
    id: string,
    payload: Partial<{
      name: string;
      address: string;
      phone: string;
      active: boolean;
      aiPlan: string;
      subscriptionPlan: string;
      subscriptionExpiresAt: string | null;
      mode: StoreMode;
      posAdminLocked: boolean;
    }>,
  ): Promise<StoreRecord> => {
    const { data } = await axiosInstance.patch(`/stores/${id}`, payload);
    return data;
  },
  delete: async (id: string): Promise<{ success: boolean }> => {
    const { data } = await axiosInstance.delete(`/stores/${id}`);
    return data;
  },
  cancelDelete: async (id: string): Promise<{ success: boolean }> => {
    const { data } = await axiosInstance.put(`/stores/${id}/cancel-delete`);
    return data;
  },
  activate: async (id: string): Promise<{ success: boolean }> => {
    const { data } = await axiosInstance.put(`/stores/${id}/activate`);
    return data;
  },
  deactivate: async (id: string): Promise<{ success: boolean }> => {
    const { data } = await axiosInstance.put(`/stores/${id}/deactivate`);
    return data;
  },
  addCredits: async (id: string, amount: number): Promise<{ success: boolean; balance: number }> => {
    const { data } = await axiosInstance.post(`/stores/${id}/credits`, { amount });
    return data;
  },
};

// ─── Terminal Logs (Super Admin) ─────────────────────────────────────────────

export interface TerminalLogEntry {
  id: string;
  storeId: string;
  terminalId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export interface LogsResponse {
  items: TerminalLogEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface LogsQueryParams {
  storeId?: string;
  terminalId?: string;
  level?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface LogsMeta {
  stores: string[];
  terminalsByStore: Record<string, string[]>;
}

export const logs = {
  getMeta: async (): Promise<LogsMeta> => {
    const { data } = await axiosInstance.get('/logs/meta');
    return data;
  },
  getLogs: async (params?: LogsQueryParams): Promise<LogsResponse> => {
    const { data } = await axiosInstance.get('/logs', { params });
    return data;
  },
};

// ─── Site Config ─────────────────────────────────────────────────────────────

export interface LoginBanner {
  imageUrl: string;
  title: string;
  subtitle: string;
}

export interface SubscriptionPlanPrices {
  starter: number;
  pro: number;
  vip: number;
}

export const siteConfig = {
  getLoginBanner: async (): Promise<LoginBanner> => {
    const { data } = await axiosInstance.get('/site-config/login-banner');
    return data;
  },
  updateLoginBanner: async (banner: LoginBanner): Promise<LoginBanner> => {
    const { data } = await axiosInstance.put('/site-config/login-banner', banner);
    return data;
  },
  uploadImage: async (file: File): Promise<{ url: string }> => {
    const form = new FormData();
    form.append('file', file);
    const { data } = await axiosInstance.post('/site-config/upload-image', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data;
  },
  getSubscriptionPlans: async (): Promise<SubscriptionPlanPrices> => {
    const { data } = await axiosInstance.get('/site-config/subscription-plans');
    return data;
  },
  setSubscriptionPlans: async (prices: SubscriptionPlanPrices): Promise<SubscriptionPlanPrices> => {
    const { data } = await axiosInstance.put('/site-config/subscription-plans', prices);
    return data;
  },
};

// ─── Analytics ───────────────────────────────────────────────────────────────

// ─── Reconciliation ──────────────────────────────────────────────────────────

/** Decimals cross the wire as strings; the UI formats them, it never does arithmetic on them. */
export interface ReconciliationLine {
  productId: number;
  productName: string;
  barcode: string;
  unit: string;
  bookQty: string;
  countedQty: string | null;
  /** book − counted. Positive = shortage, negative = surplus, null = not counted. */
  varianceQty: string | null;
  varianceCost: string | null;
  varianceRetail: string | null;
  anchorAt: string | null;
  suppressedCount: number;
}

export interface ReconciliationCrossCheckRow {
  productId: number;
  productName: string;
  barcode: string;
  perpetual: string;
  recomputed: string;
  drift: string;
}

export interface GoodsReconciliation {
  periodStart: string | null;
  periodEnd: string;
  countId: string | null;
  lines: ReconciliationLine[];
  totals: {
    shortageQtyLines: number;
    surplusQtyLines: number;
    varianceCost: string;
    varianceRetail: string;
  };
  crossCheck: { clean: boolean; rows: ReconciliationCrossCheckRow[] };
  ledgerEnabled: boolean;
}

export interface MoneyReconciliation {
  periodStart: string;
  periodEnd: string;
  byTender: { tender: string; amount: string; saleCount: number }[];
  gross: string;
  discounts: string;
  netSales: string;
  newDebts: string;
  expectedCollected: string;
  actuallyCollected: string | null;
  cashVariance: string | null;
  limitation: string | null;
  drawer: {
    shiftCount: number;
    expectedCash: string;
    actualCash: string | null;
  };
}

export const reconciliation = {
  goods: async (params?: {
    from?: string;
    to?: string;
    countId?: string;
  }): Promise<GoodsReconciliation> => {
    const { data } = await axiosInstance.get("/reconciliation/goods", { params });
    return data;
  },
  money: async (params: { from: string; to: string }): Promise<MoneyReconciliation> => {
    const { data } = await axiosInstance.get("/reconciliation/money", { params });
    return data;
  },
  seedOpening: async (): Promise<{ seeded: number; enabled: boolean }> => {
    const { data } = await axiosInstance.post("/reconciliation/seed-opening");
    return data;
  },
};

export const analytics = {
  getData: async (filters: { startDate: string; endDate: string }) => {
    const { data } = await axiosInstance.get("/analytics/data", {
      params: filters,
    });
    return data;
  },
};

// ─── MXIK ────────────────────────────────────────────────────────────────────

export interface MxikScanInfo {
  name: string;
  brandName: string | null;
  attributeName: string | null;
  unitsName: string | null;
  groupCode: string | null;
  // Authoritative Asl-Belgisi marking flag from tasnif `label` (1 = marked). Null = unknown.
  isMarked: boolean | null;
}

export type { CatalogEntry };

// tasnif `label` → boolean (1 = marked, 0 = plain). Null when absent/unparseable.
function labelToIsMarked(label: unknown): boolean | null {
  if (label === null || label === undefined || label === '') return null;
  return Number(label) === 1;
}

export const mxik = {
  lookupCode: async (code: string): Promise<{ code: string; name: string; nameRu: string; packageCode: string; isMarked: boolean | null }> => {
    const { data } = await axiosInstance.get(`/mxik/code/${encodeURIComponent(code)}`);
    return data;
  },
  searchByBarcode: async (barcode: string): Promise<{ code: string; name: string; nameRu: string; packageCode: string; isMarked: boolean | null }> => {
    // Call tasnif directly from browser (VPS is geo-blocked; browser is in Uzbekistan)
    const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';
    const searchRes = await fetch(`${TASNIF}/elasticsearch/search?lang=uz_cyrl&search=${encodeURIComponent(barcode)}&size=5&page=0`);
    const searchJson = await searchRes.json();
    if (!searchJson.success || !searchJson.data?.length) throw new Error('Not found');
    // Exact barcode match only — tasnif's search is fuzzy and its first row is regularly a
    // different product with a near-miss barcode (see findBarcodeMatch).
    const match = findBarcodeMatch(searchJson.data as Array<{ internationalCode?: string | null; mxikCode: string; label?: unknown }>, barcode);
    if (!match) throw new Error('Not found');
    const mxikCode: string = match.mxikCode;
    // The elasticsearch match row carries the authoritative `label` marking flag.
    const isMarked = labelToIsMarked(match.label);
    const detailRes = await fetch(`${TASNIF}/integration-mxik/get/history/${mxikCode}`);
    const detailJson = await detailRes.json();
    if (!detailJson.success || !detailJson.data) throw new Error('Not found');
    const d = detailJson.data;
    const brand = d.brandName ? `${d.brandName} ` : '';
    return {
      code: d.mxikCode,
      name: brand + (d.attributeNameUz ?? d.subPositionNameUz),
      nameRu: brand + (d.attributeNameRu ?? d.subPositionNameRu),
      // The single-unit package, not packageNames[0] — that first entry is often a
      // multi-pack ("блок=6 шт"), and a piece-sold product must report the unit package.
      packageCode: pickSingleUnitPackage(mapPackageNames(d.packageNames))?.code ?? '796',
      isMarked,
    };
  },
  // Batch MXIK lookup via by-params endpoint (called directly from browser — VPS is geo-blocked)
  lookupBatch: async (codes: string[]): Promise<Record<string, MxikScanInfo>> => {
    const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';
    const results = await Promise.allSettled(
      codes.map(async (code) => {
        const res = await fetch(
          `${TASNIF}/mxik/search/by-params?mxikCode=${encodeURIComponent(code)}&size=1&page=0&lang=uz_cyrl`,
          { signal: AbortSignal.timeout(6000) },
        );
        const json = await res.json() as { success: boolean; data: Array<{ mxikCode: string; name: string; brandName: string; attributeName: string; unitsName: string; groupCode: string; label: unknown }> };
        if (!json.success || !json.data?.length) return { code, info: null };
        const d = json.data[0];
        return {
          code,
          info: {
            name: d.name,
            brandName: d.brandName || null,
            attributeName: d.attributeName || null,
            unitsName: d.unitsName || null,
            groupCode: d.groupCode || null,
            isMarked: labelToIsMarked(d.label),
          } satisfies MxikScanInfo,
        };
      }),
    );
    const map: Record<string, MxikScanInfo> = {};
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.info) {
        map[r.value.code] = r.value.info;
      }
    }
    return map;
  },

  // ─── Local MxikCatalog endpoints (fast, offline-capable, no geo-restriction) ─

  catalogGroups: async (): Promise<MxikGroup[]> => {
    const { data } = await axiosInstance.get('/mxik/catalog/groups');
    return data;
  },

  // Package (unit) codes for an MXIK — called directly against tasnif (browser is in UZ).
  getPackages: async (mxikCode: string): Promise<MxikPackage[]> => {
    if (!/^\d{17}$/.test(mxikCode)) return [];
    try {
      const res = await fetch(`https://tasnif.soliq.uz/api/cls-api/integration-mxik/get/history/${mxikCode}`);
      if (!res.ok) return [];
      const json = await res.json();
      return mapPackageNames(json?.data?.packageNames);
    } catch {
      return [];
    }
  },

  catalogLookup: async (barcode: string): Promise<CatalogEntry | null> => {
    try {
      const { data } = await axiosInstance.get(`/mxik/catalog/lookup?barcode=${encodeURIComponent(barcode)}`);
      return data ?? null;
    } catch {
      return null;
    }
  },

  catalogSearch: async (
    q: string,
    page = 0,
    size = 10,
  ): Promise<{ results: CatalogEntry[]; total: number }> => {
    try {
      const url = `https://tasnif.soliq.uz/api/cls-api/elasticsearch/search?lang=uz_cyrl&search=${encodeURIComponent(q)}&size=${size}&page=${page}`;
      const res = await fetch(url);
      if (!res.ok) return { results: [], total: 0 };
      const json = await res.json();
      const items: CatalogEntry[] = (json.data ?? []).map((item: any) => ({
        mxikCode: item.mxikCode,
        mxikName: item.name,
        groupCode: item.groupCode,
        groupName: item.groupName,
        classCode: item.classCode,
        className: item.className,
        internationalCode: item.internationalCode ?? null,
        unitName: item.unitsName ?? item.packageName ?? null,
      }));
      return { results: items, total: json.recordTotal ?? 0 };
    } catch {
      return { results: [], total: 0 };
    }
  },
};

// ─── ASL-BELGISI ─────────────────────────────────────────────────────────────

// Normalize a GS1 DataMatrix string from a scanner:
// - Strip ZXing symbology prefix (]d2, ]C1, ]e0)
// - Strip leading FNC1 (\x1d) — the GS1 mode indicator prepended by some decoders
// - Keep internal \x1d characters — they are AI separators required by aslbelgisi
function normalizeDataMatrix(raw: string): string {
  return raw.replace(/^\](d2|C1|e0)/, '').replace(/^\x1d/, '');
}

export const aslBelgisi = {
  /**
   * Verify a DataMatrix marking code via the server proxy.
   * The server adds the ASLBELGISI_API_KEY Bearer token.
   */
  verifyMarkingCode: async (markingCode: string): Promise<{
    isValid: boolean;
    status?: string;
    extendedStatus?: string;
    gtin?: string;
    productId?: string;
    productionDate?: string;
    expirationDate?: string;
    productSeries?: string;
    issuerName?: string;
    packageType?: string;
    _error?: string;
  }> => {
    try {
      const normalized = normalizeDataMatrix(markingCode);
      const { data } = await axiosInstance.post('/aslbelgisi/verify', { code: normalized });
      return data;
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? String(e);
      return { isValid: false, _error: `HTTP ${e?.response?.status ?? '?'}: ${msg}` };
    }
  },

  /** Extract EAN-13 barcode from a 14-digit GTIN (strips leading zero). */
  extractGtinFromDataMatrix: (dataMatrix: string): string | null => {
    const normalized = normalizeDataMatrix(dataMatrix);
    const match = normalized.match(/^01(\d{14})/);
    if (!match) return null;
    const gtin14 = match[1];
    // GS1 GTIN-14 with leading 0 → EAN-13
    return gtin14.startsWith('0') ? gtin14.slice(1) : gtin14;
  },

  /** Detect QR/barcode type to route scanning logic correctly. */
  detectQrType: (qrData: string): 'fiscal' | 'datamatrix' | 'mxik' | 'barcode' => {
    if (qrData.includes('http://') || qrData.includes('https://')) return 'fiscal';
    // GS1 DataMatrix: raw or with ZXing ]d2/]C1 prefix, starts with AI "01" + 14 digits
    const normalized = normalizeDataMatrix(qrData);
    if (/^01\d{14}/.test(normalized)) return 'datamatrix';
    if (/^\d{17}$/.test(qrData)) return 'mxik';
    return 'barcode';
  },
};

// ─── Combined export ─────────────────────────────────────────────────────────

export const api = {
  auth,
  products,
  categories,
  inventory,
  inventoryCounts,
  suppliers,
  sales,
  users,
  settings,
  receipt,
  stores,
  logs,
  analytics,
  mxik,
  aslBelgisi,
};
