import { getPrismaClient } from '../database/sqlite-client';
import { getAppConfig } from '../config/app-config';
import { getServerToken } from './queue-manager';

export async function syncProducts(): Promise<{ id: number; nameRu: string; stock: number }[]> {
  const prisma = getPrismaClient();
  const config = getAppConfig();

  const token = getServerToken();
  if (!token) {
    throw new Error('No server token available — log in first to sync');
  }

  // Get last sync timestamp
  const lastSyncSetting = await prisma.systemSetting.findUnique({
    where: { key: 'last_product_sync' },
  });
  const lastSync = lastSyncSetting?.value || new Date(0).toISOString();


  try {
    const response = await fetch(
      `${config.vpsApiUrl}/products?updatedAfter=${encodeURIComponent(lastSync)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch products: ${response.statusText}`);
    }

    const products = await response.json();

    if (!Array.isArray(products) || products.length === 0) {
      return [];
    }

    // Build local category lookup maps to resolve VPS categoryId → local id.
    // VPS ids may differ from SQLite autoincrement ids; fall back to nameUz match.
    const localCategories = await prisma.category.findMany({ select: { id: true, nameUz: true } });
    const catById  = new Map(localCategories.map((c: { id: number; nameUz: string }) => [c.id, c.id]));
    const catByName = new Map(localCategories.map((c: { id: number; nameUz: string }) => [c.nameUz, c.id]));

    const resolveCategoryId = (p: { categoryId: number; category?: { nameUz?: string } }): number => {
      if (catById.has(p.categoryId)) return p.categoryId;
      const byName = p.category?.nameUz ? catByName.get(p.category.nameUz) : undefined;
      if (typeof byName === 'number') return byName;
      return p.categoryId; // fall back to VPS id — will still fail FK but at least we tried
    };

    // Track the earliest updatedAt among failed products so we can roll back the cursor.
    let earliestFailedUpdatedAt: Date | null = null;

    // Create a product locally, preferring the VPS id but falling back to a local
    // autoincrement id when that id is already taken by a different product. The server
    // matches sales by barcode (local ids are per-terminal autoincrements), so a divergent
    // local id is safe — this prevents a unique-constraint crash when a terminal's DB and
    // the VPS have different id lineages (e.g. after repointing to another environment).
    const createProductLocal = async (p: typeof products[number]): Promise<void> => {
      const data: Record<string, unknown> = {
        barcode: p.barcode,
        nameRu: p.nameRu,
        nameUz: p.nameUz,
        price: p.price,
        cost: p.cost ?? null,
        stock: p.stock,
        minStock: p.minStock,
        unit: p.unit,
        categoryId: resolveCategoryId(p),
        active: p.active,
        mxik: p.mxik ?? null,
        packageCode: p.packageCode ?? null,
        vatRate: p.vatRate ?? null,
        isMarked: p.isMarked ?? null,
        productType: p.productType ?? 'REGULAR',
        internalCode: p.internalCode ?? null,
        storeProductCode: p.storeProductCode ?? null,
        createdAt: new Date(p.createdAt),
        updatedAt: new Date(p.updatedAt),
      };
      const idTaken = await prisma.product.findUnique({ where: { id: p.id }, select: { id: true } });
      if (!idTaken) data.id = p.id; // keep ids aligned when free; else autoincrement
      await prisma.product.create({ data });
    };

    for (const product of products) {
      // Never write negative stock from VPS to local DB — clamp to 0.
      // Negative VPS stock indicates a drift between terminals/admin edits;
      // local should show "out of stock" (0) rather than a nonsensical negative.
      if (product.stock < 0) product.stock = 0;

      // If this product has an internalCode, check whether another local product
      // already owns it. If so, clear that conflict first to avoid a unique violation.
      if (product.internalCode) {
        const conflicting = await prisma.product.findFirst({
          where: {
            internalCode: String(product.internalCode),
            NOT: { barcode: product.barcode },
          },
          select: { id: true },
        });
        if (conflicting) {
          await prisma.product.update({
            where: { id: conflicting.id },
            data: { internalCode: null },
          });
        }
      }

      // Check if a product with the same barcode already exists locally
      const existing = await prisma.product.findUnique({
        where: { barcode: product.barcode },
        select: { id: true },
      });

      try {
        if (existing) {
          // A product with this barcode already exists locally — update it IN PLACE by its local
          // id, even when that id differs from the server's. Never delete+recreate to "realign"
          // ids: the server matches sales by BARCODE (see createProductLocal), so a divergent local
          // id is harmless, and deleting a referenced product throws a foreign-key violation. The
          // old saleCount guard only checked sale_items, but inventory_arrivals and pre_weighed_items
          // also reference products — so the delete still failed and the row re-failed every sync.
          await prisma.product.update({
            where: { id: existing.id },
            data: {
              nameRu: product.nameRu,
              nameUz: product.nameUz,
              price: product.price,
              stock: product.stock,
              minStock: product.minStock,
              unit: product.unit,
              categoryId: resolveCategoryId(product),
              active: product.active,
              mxik: product.mxik ?? null,
              packageCode: product.packageCode ?? null,
              vatRate: product.vatRate ?? null,
              isMarked: product.isMarked ?? null,
              productType: product.productType ?? 'REGULAR',
              internalCode: product.internalCode ?? null,
              storeProductCode: product.storeProductCode ?? null,
              updatedAt: new Date(product.updatedAt),
            },
          });
        } else {
          // No local product with this barcode — create it (VPS id if free, else autoincrement)
          await createProductLocal(product);
        }
      } catch (productError) {
        // Log and skip — one bad product must not abort the entire sync
        console.error(`Failed to sync product barcode=${product.barcode}:`, productError instanceof Error ? productError.message : productError);
        // Track earliest failure so the cursor doesn't advance past it
        const failedAt = new Date(product.updatedAt);
        if (!earliestFailedUpdatedAt || failedAt < earliestFailedUpdatedAt) {
          earliestFailedUpdatedAt = failedAt;
        }
      }
    }

    // Advance the sync cursor to the newest server `updatedAt` we actually saw —
    // NOT the terminal clock. Using the terminal's `now()` skips rows whenever the
    // terminal clock drifts ahead of the server, or after repointing the terminal
    // to another environment (the carried-over cursor can be newer than the target
    // env's rows, so `updatedAfter` filters them out and they never sync down).
    // On failure, roll back to just before the earliest failure so it retries next cycle.
    const maxUpdatedAt = products.reduce(
      (max: number, p: { updatedAt: string }) => Math.max(max, new Date(p.updatedAt).getTime()),
      0,
    );
    const nextCursor = earliestFailedUpdatedAt
      ? new Date(earliestFailedUpdatedAt.getTime() - 1000).toISOString()
      : new Date(maxUpdatedAt).toISOString();

    await prisma.systemSetting.upsert({
      where: { key: 'last_product_sync' },
      update: { value: nextCursor },
      create: { key: 'last_product_sync', value: nextCursor },
    });

    // Detect stock conflicts: products that went negative after VPS overwrite
    const conflicted = await prisma.product.findMany({
      where: { stock: { lt: 0 } },
      select: { id: true, nameRu: true, stock: true },
    });

    return conflicted.map((p: { id: number; nameRu: string; stock: unknown }) => ({ id: p.id, nameRu: p.nameRu, stock: Number(p.stock) }));

  } catch (error) {
    console.error('Failed to sync products:', error);
    throw error;
  }
}

export async function syncSuppliers(): Promise<void> {
  const prisma = getPrismaClient();
  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return;

  try {
    const response = await fetch(`${config.vpsApiUrl}/suppliers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;

    const suppliers = await response.json();
    if (!Array.isArray(suppliers) || suppliers.length === 0) return;

    for (const s of suppliers) {
      await prisma.supplier.upsert({
        where: { id: s.id },
        update: {
          nameUz: s.nameUz,
          nameRu: s.nameRu,
          phone: s.phone || null,
          address: s.address || null,
          active: s.active ?? true,
          balance: s.balance ?? 0,
          paymentType: s.paymentType ?? 'IMMEDIATE',
        },
        create: {
          id: s.id,
          nameUz: s.nameUz,
          nameRu: s.nameRu,
          phone: s.phone || null,
          address: s.address || null,
          active: s.active ?? true,
          balance: s.balance ?? 0,
          paymentType: s.paymentType ?? 'IMMEDIATE',
        },
      });
    }
  } catch (error) {
    console.error('Failed to sync suppliers:', error instanceof Error ? error.message : error);
  }
}

export async function syncUsers(): Promise<void> {
  const prisma = getPrismaClient();
  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return;

  // Extract storeId from the server token so we can tag synced users
  let tokenStoreId: string | null = null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()) as { storeId?: string | null };
    tokenStoreId = payload.storeId ?? null;
  } catch { /* ignore */ }

  console.log(`[syncUsers] token storeId=${tokenStoreId}`);

  try {
    const response = await fetch(`${config.vpsApiUrl}/users/sync`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[syncUsers] VPS /users/sync status: ${response.status}`);
    if (!response.ok) return;

    const users = await response.json();
    console.log(`[syncUsers] VPS returned ${Array.isArray(users) ? users.length : 'non-array'} users:`, Array.isArray(users) ? users.map((u: { phone: string; role: string }) => `${u.phone}(${u.role})`).join(', ') : users);
    if (!Array.isArray(users) || users.length === 0) return;

    const syncedPhones: string[] = [];

    for (const u of users) {
      try {
        await prisma.user.upsert({
          where: { phone: u.phone },
          update: {
            password: u.password,
            role: u.role,
            nameUz: u.nameUz,
            nameRu: u.nameRu,
            active: u.active ?? true,
            storeId: tokenStoreId,
          },
          create: {
            id: u.id,
            phone: u.phone,
            password: u.password,
            role: u.role,
            nameUz: u.nameUz,
            nameRu: u.nameRu,
            active: u.active ?? true,
            storeId: tokenStoreId,
          },
        });
        syncedPhones.push(u.phone);
      } catch (userError) {
        console.error(`Failed to sync user phone=${u.phone}:`, userError instanceof Error ? userError.message : userError);
      }
    }

    // Mirror VPS: remove any local user not returned by this sync (both cross-store
    // pollution and users deleted on the server side)
    if (tokenStoreId && syncedPhones.length > 0) {
      await prisma.user.deleteMany({
        where: { phone: { notIn: syncedPhones } },
      });
    }
  } catch (error) {
    console.error('Failed to sync users:', error instanceof Error ? error.message : error);
  }
}

export async function syncCategories(): Promise<void> {
  const prisma = getPrismaClient();
  const config = getAppConfig();

  const token = getServerToken();
  if (!token) {
    throw new Error('No server token available — log in first to sync');
  }

  try {
    const response = await fetch(`${config.vpsApiUrl}/categories`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch categories: ${response.statusText}`);
    }

    const categories = await response.json();

    if (!Array.isArray(categories) || categories.length === 0) {
      return;
    }


    const productCount = await prisma.product.count();
    if (productCount === 0) {
      // No products yet — safe to fully replace categories with VPS IDs
      await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;
      await prisma.$executeRaw`DELETE FROM categories`;
      await prisma.$executeRaw`DELETE FROM sqlite_sequence WHERE name='categories'`;
      await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
      for (const category of categories) {
        await prisma.category.create({
          data: {
            id: category.id,
            nameRu: category.nameRu,
            nameUz: category.nameUz,
            active: category.active,
            ...(category.mxikGroupCode != null ? { mxikGroupCode: category.mxikGroupCode } : {}),
          },
        });
      }
    } else {
      // Products exist — match by nameUz to avoid breaking categoryId references
      let newCategoryAdded = false;
      for (const category of categories) {
        const existing = await prisma.category.findFirst({
          where: { nameUz: category.nameUz },
        });

        if (existing) {
          if (existing.id !== category.id) {
            // ID mismatch: server uses a different ID for this category name (e.g. after
            // a duplicate-cleanup migration on the server). Remap all local products to
            // the server-canonical ID, then replace the stale category entry.
            await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;
            try {
              await prisma.product.updateMany({
                where: { categoryId: existing.id },
                data: { categoryId: category.id },
              });
              await prisma.category.delete({ where: { id: existing.id } });
              const alreadyAtServerId = await prisma.category.findUnique({
                where: { id: category.id },
              });
              if (alreadyAtServerId) {
                await prisma.category.update({
                  where: { id: category.id },
                  data: { nameRu: category.nameRu, nameUz: category.nameUz, active: category.active, mxikGroupCode: category.mxikGroupCode ?? null },
                });
              } else {
                await prisma.$executeRaw`
                  INSERT INTO categories (id, name_uz, name_ru, active, mxik_group_code, created_at, updated_at)
                  VALUES (${category.id}, ${category.nameUz}, ${category.nameRu}, ${category.active ? 1 : 0}, ${category.mxikGroupCode ?? null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `;
              }
            } finally {
              await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
            }
            // Reset product sync cursor so syncProducts() re-pulls with correct IDs.
            newCategoryAdded = true;
          } else {
            await prisma.category.update({
              where: { id: existing.id },
              data: { nameRu: category.nameRu, active: category.active, mxikGroupCode: category.mxikGroupCode ?? null },
            });
          }
        } else {
          // Force VPS id so new products can satisfy the FK when they sync
          try {
            await prisma.$executeRaw`
              INSERT INTO categories (id, name_uz, name_ru, active, mxik_group_code, created_at, updated_at)
              VALUES (${category.id}, ${category.nameUz}, ${category.nameRu}, ${category.active ? 1 : 0}, ${category.mxikGroupCode ?? null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `;
            newCategoryAdded = true;
          } catch {
            // id collision — fall back to autoincrement (rare; new products in this category won't sync until resolved)
            await prisma.category.create({
              data: { nameRu: category.nameRu, nameUz: category.nameUz, active: category.active, mxikGroupCode: category.mxikGroupCode ?? null },
            });
          }
        }
      }
      // A new category means new products may have been silently skipped in prior syncs.
      // Reset the product sync cursor so the next syncProducts() does a full pull.
      if (newCategoryAdded) {
        await prisma.systemSetting.deleteMany({ where: { key: 'last_product_sync' } });
      }
    }
  } catch (error) {
    console.error('Failed to sync categories:', error);
    throw error;
  }
}

// Keys that live only on the terminal and must never be overwritten by VPS sync
const LOCAL_ONLY_SETTINGS = new Set([
  'server_token',
  'last_product_sync',
  'last_sale_sync',
  'last_upload_sync',
  'ai_token_limit_daily',
]);

export async function syncSettings(): Promise<void> {
  const prisma = getPrismaClient();
  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return;

  try {
    const response = await fetch(`${config.vpsApiUrl}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;

    const settings = await response.json() as Record<string, string>;

    for (const [key, value] of Object.entries(settings)) {
      if (LOCAL_ONLY_SETTINGS.has(key)) continue;
      if (typeof value !== 'string') continue;

      await prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    }
  } catch (error) {
    console.error('Failed to sync settings:', error instanceof Error ? error.message : error);
  }
}
