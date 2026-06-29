import { getPrismaClient } from "../database/sqlite-client";
import { getAppConfig } from "../config/app-config";
import { getServerToken } from "./queue-manager";
import type {
  Category,
  Supplier,
  Product,
  InventoryArrival,
  User,
} from "../../generated/prisma-sqlite";

async function apiPost(
  url: string,
  token: string,
  body: unknown,
): Promise<Response> {
  const config = getAppConfig();
  return fetch(`${config.vpsApiUrl}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function getLastUploadTime(
  prisma: ReturnType<typeof getPrismaClient>,
): Promise<Date> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "last_upload_sync" },
  });
  return setting ? new Date(setting.value) : new Date(0);
}

async function setLastUploadTime(
  prisma: ReturnType<typeof getPrismaClient>,
): Promise<void> {
  const now = new Date().toISOString();
  await prisma.systemSetting.upsert({
    where: { key: "last_upload_sync" },
    update: { value: now },
    create: { key: "last_upload_sync", value: now },
  });
}

export async function uploadLocalData(): Promise<void> {
  const prisma = getPrismaClient();
  const token = getServerToken();
  if (!token) {
    return; // No server token yet — will retry on next sync cycle
  }

  const since = await getLastUploadTime(prisma);

  await uploadUsers(prisma, token);
  await uploadCategories(prisma, token, since);
  await uploadSuppliers(prisma, token, since);
  await uploadProducts(prisma, token, since);
  await uploadArrivals(prisma, token, since);
  await uploadSettings(prisma, token);

  await setLastUploadTime(prisma);
}

async function uploadUsers(
  prisma: ReturnType<typeof getPrismaClient>,
  token: string,
): Promise<void> {
  const localConfig = await prisma.localConfig.findUnique({ where: { id: 'config' } });
  const storeId = localConfig?.storeId;
  // Only upload users that belong to this store — never push cross-store cached users
  const users = await prisma.user.findMany({ where: storeId ? { storeId } : {} });

  if (users.length === 0) return;

  const payload = users.map((u: User) => ({
    id: u.id,
    phone: u.phone,
    password: u.password,
    nameUz: u.nameUz,
    nameRu: u.nameRu,
    role: u.role,
    active: u.active,
  }));

  const res = await apiPost("/users/sync-bulk", token, { users: payload });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Failed to upload users (HTTP ${res.status}): ${text}`);
  }
}

async function uploadCategories(
  prisma: ReturnType<typeof getPrismaClient>,
  token: string,
  _since: Date,
): Promise<void> {
  // Always upload all categories — they are few, so this avoids missing categories created before
  // last_upload_sync was set. The VPS treats /categories/sync-bulk as CREATE-ONLY (see
  // categories.service.ts syncBulk): it is the source of truth for category master data and will
  // NOT overwrite an existing category from this payload (active / names / mxik_group_code). The
  // fields below therefore only take effect for brand-new offline-created categories.
  const categories = await prisma.category.findMany({});

  if (categories.length === 0) {
    return;
  }

  const payload = categories.map((c: Category) => ({
    nameUz: c.nameUz,
    nameRu: c.nameRu,
    active: c.active,
    mxikGroupCode: c.mxikGroupCode ?? null,
  }));

  const res = await apiPost("/categories/sync-bulk", token, {
    categories: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload categories: ${text}`);
  }
}

async function uploadSuppliers(
  prisma: ReturnType<typeof getPrismaClient>,
  token: string,
  since: Date,
): Promise<void> {
  const suppliers = await prisma.supplier.findMany({
    where: { createdAt: { gt: since } },
  });

  if (suppliers.length === 0) {
    return;
  }

  const payload = suppliers.map((s: Supplier) => ({
    id: s.id,
    nameUz: s.nameUz,
    nameRu: s.nameRu,
    phone: s.phone || undefined,
    address: s.address || undefined,
    active: s.active,
  }));

  const res = await apiPost("/suppliers/sync-bulk", token, {
    suppliers: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload suppliers: ${text}`);
  }
}

async function uploadProducts(
  prisma: ReturnType<typeof getPrismaClient>,
  token: string,
  since: Date,
): Promise<void> {
  // NOTE: the VPS treats /products/sync-bulk as CREATE-ONLY (see products.service.ts syncBulk) —
  // the server is the source of truth for product master data and will NOT overwrite an existing
  // product from this payload. So the master fields below (active, price, name, …) only ever take
  // effect for brand-new offline-created products; for products already on the VPS they are
  // ignored. A product's updatedAt bumps on every sale (stock decrement), so this query also
  // re-sends already-synced products each cycle — that's harmless given the server-side guard.
  const products = await prisma.product.findMany({
    where: { updatedAt: { gt: since } },
  });

  if (products.length === 0) {
    return;
  }

  const payload = products.map((p: Product) => ({
    barcode: p.barcode,
    nameUz: p.nameUz,
    nameRu: p.nameRu,
    price: Number(p.price),
    cost: p.cost ? Number(p.cost) : undefined,
    stock: Number(p.stock),
    minStock: Number(p.minStock),
    unit: p.unit,
    categoryId: p.categoryId,
    active: p.active,
    productType: p.productType,
    internalCode: p.internalCode ?? undefined,
    bulkQuantity: p.bulkQuantity ? Number(p.bulkQuantity) : undefined,
    minSaleQty: p.minSaleQty ? Number(p.minSaleQty) : undefined,
    maxSaleQty: p.maxSaleQty ? Number(p.maxSaleQty) : undefined,
  }));

  const res = await apiPost("/products/sync-bulk", token, {
    products: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload products: ${text}`);
  }
}

async function uploadArrivals(
  prisma: ReturnType<typeof getPrismaClient>,
  token: string,
  since: Date,
): Promise<void> {
  const arrivals = await prisma.inventoryArrival.findMany({
    where: { createdAt: { gt: since } },
    include: { product: true },
  });

  if (arrivals.length === 0) {
    return;
  }

  const payload = arrivals.map(
    (a: InventoryArrival & { product: Product }) => ({
      id: a.id,
      productBarcode: a.product.barcode,
      supplierId: a.supplierId || undefined,
      quantity: Number(a.quantity),
      cost: Number(a.cost),
      notes: a.notes || undefined,
      createdBy: a.createdBy,
      createdAt: a.createdAt.toISOString(),
    }),
  );

  const res = await apiPost("/inventory/arrivals/sync-bulk", token, {
    arrivals: payload,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to upload arrivals: ${text}`);
  }
}

// Keys that should never be pushed to VPS (terminal-local only)
const LOCAL_ONLY_SETTINGS = new Set([
  'server_token',
  'last_product_sync',
  'last_sale_sync',
  'last_upload_sync',
  'last_audit_log_sync',
  'ai_token_limit_daily',
]);

async function uploadSettings(
  prisma: ReturnType<typeof getPrismaClient>,
  token: string,
): Promise<void> {
  const settings = await prisma.systemSetting.findMany();

  const config = getAppConfig();

  for (const s of settings) {
    if (LOCAL_ONLY_SETTINGS.has(s.key)) continue;

    try {
      await fetch(`${config.vpsApiUrl}/settings/${encodeURIComponent(s.key)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ value: s.value }),
      });
    } catch {
      // Non-fatal — will retry next cycle
    }
  }
}
