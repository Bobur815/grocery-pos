// src/main/ipc/products-handlers.ts
import { ipcMain } from "electron";
import { getPrismaClient } from "../database/sqlite-client";
import { getCurrentUser } from "./auth-handlers";
import { Product, ProductFilterParams } from "@shared/types";

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  if (typeof value === "object" && value !== null) {
    if ("toNumber" in value && typeof (value as any).toNumber === "function") {
      return (value as any).toNumber();
    }
  }
  return 0;
}

function toNumberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return toNumber(value);
}

function toISOString(value: unknown): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date().toISOString();
}

function serializeProduct(product: any): Product | null {
  if (!product) return null;

  const result: Product = {
    id: Number(product.id),
    barcode: String(product.barcode || ""),
    nameRu: String(product.nameRu || ""),
    nameUz: String(product.nameUz || ""),
    price: toNumber(product.price),
    cost: toNumberOrUndefined(product.cost),
    stock: toNumber(product.stock),
    minStock: toNumber(product.minStock),
    unit: String(product.unit || "шт") as Product["unit"],
    categoryId:
      product.categoryId != null ? Number(product.categoryId) : undefined,
    supplierId: product.supplierId || undefined,
    productionDate: product.productionDate
      ? toISOString(product.productionDate)
      : undefined,
    expiryDate: product.expiryDate
      ? toISOString(product.expiryDate)
      : undefined,
    discountPercent: toNumberOrUndefined(product.discountPercent),
    isOnPromotion: Boolean(product.isOnPromotion ?? false),
    pendingPrice:
      product.pendingPrice != null ? toNumber(product.pendingPrice) : null,
    pendingPriceThreshold:
      product.pendingPriceThreshold != null
        ? toNumber(product.pendingPriceThreshold)
        : null,
    mxik: product.mxik || undefined,
    packageCode: product.packageCode || undefined,
    vatRate: product.vatRate != null ? Number(product.vatRate) : null,
    isMarked: product.isMarked != null ? Boolean(product.isMarked) : null,
    isActive: Boolean(product.active ?? true),
    createdAt: toISOString(product.createdAt),
    updatedAt: toISOString(product.updatedAt),
    // Weighted fields
    productType: (product.productType || "REGULAR") as Product["productType"],
    internalCode: product.internalCode || undefined,
    bulkQuantity: toNumber(product.bulkQuantity),
    minSaleQty: toNumber(product.minSaleQty),
    maxSaleQty: toNumber(product.maxSaleQty),
    storeProductCode: product.storeProductCode != null ? Number(product.storeProductCode) : null,
  };

  if (product.category) {
    result.category = {
      id: Number(product.category.id),
      nameRu: String(product.category.nameRu || ""),
      nameUz: String(product.category.nameUz || ""),
      mxikGroupCode: (product.category as any).mxikGroupCode ?? null,
      createdAt: toISOString(product.category.createdAt),
      updatedAt: toISOString(product.category.updatedAt),
    };
  }

  if (product.supplier) {
    result.supplier = {
      id: String(product.supplier.id),
      nameRu: String(product.supplier.nameRu || ""),
      nameUz: String(product.supplier.nameUz || ""),
      phone: product.supplier.phone || undefined,
      address: product.supplier.address || undefined,
      active: Boolean(product.supplier.active ?? true),
      balance: toNumber(product.supplier.balance),
      paymentType: (product.supplier as any).paymentType ?? 'IMMEDIATE',
      createdAt: toISOString(product.supplier.createdAt),
    };
  }

  return result;
}

/** Ensure the value is a plain JSON-safe object that Electron IPC can clone. */
function ipcSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Next local product code. The renderer shows/looks-up products as
 * `storeProductCode ?? id`, so an un-coded product is displayed by its `id`.
 * Pick a code above both the highest existing code and the highest id among
 * un-coded products so a new code can't collide with an id-displayed product.
 * This is a provisional value — the server reassigns the authoritative code on
 * sync (matches the VPS `getNextStoreProductCode` logic).
 */
async function getNextStoreProductCode(
  prisma: ReturnType<typeof getPrismaClient>,
): Promise<number> {
  const [codeAgg, uncodedIdAgg] = await Promise.all([
    prisma.product.aggregate({ _max: { storeProductCode: true } }),
    prisma.product.aggregate({
      where: { storeProductCode: null },
      _max: { id: true },
    }),
  ]);
  const maxCode = codeAgg._max.storeProductCode ?? 0;
  const maxUncodedId = uncodedIdAgg._max.id ?? 0;
  return Math.max(maxCode, maxUncodedId) + 1;
}

export function setupProductsHandlers(): void {
  ipcMain.handle(
    "products:getAll",
    async (_event, filters?: ProductFilterParams) => {
      const prisma = getPrismaClient();

      const where: Record<string, unknown> = {};

      // Text search (query)
      if (filters?.query) {
        const q = filters.query.toLowerCase();
        const numericId = Number(q);
        const orConditions: any[] = [
          { barcode: { contains: q } },
          { nameRu: { contains: q } },
          { nameUz: { contains: q } },
        ];
        if (!isNaN(numericId) && Number.isInteger(numericId) && numericId > 0) {
          orConditions.unshift({ id: { equals: numericId } });
        }
        where.OR = orConditions;
      }

      if (filters?.categoryId) {
        where.categoryId = filters.categoryId;
      }

      if (filters?.supplierId) {
        where.supplierId = filters.supplierId;
      }

      // Price range
      if (filters?.priceMin !== undefined || filters?.priceMax !== undefined) {
        const priceFilter: Record<string, number> = {};
        if (filters?.priceMin !== undefined) priceFilter.gte = filters.priceMin;
        if (filters?.priceMax !== undefined) priceFilter.lte = filters.priceMax;
        where.price = priceFilter;
      }

      // Unit
      if (filters?.unit && filters.unit !== "all") {
        where.unit = filters.unit;
      }

      // Promotion status
      if (filters?.promotionStatus === "on_promotion") {
        where.isOnPromotion = true;
      } else if (filters?.promotionStatus === "no_promotion") {
        where.isOnPromotion = false;
      }

      // Stock availability (partial — out_of_stock and in_stock can be done in Prisma)
      if (filters?.availability === "out_of_stock") {
        where.stock = { lte: 0 };
      } else if (
        filters?.availability === "in_stock" ||
        filters?.availability === "low_stock"
      ) {
        where.stock = { gt: 0 };
      }

      // Expiry status
      if (filters?.expiryStatus && filters.expiryStatus !== "all") {
        const now = new Date();
        const threeDaysLater = new Date(
          now.getTime() + 3 * 24 * 60 * 60 * 1000,
        );
        if (filters.expiryStatus === "expired") {
          where.expiryDate = { lt: now, not: null };
        } else if (filters.expiryStatus === "expiring_soon") {
          where.expiryDate = { gte: now, lte: threeDaysLater };
        } else if (filters.expiryStatus === "fresh") {
          where.expiryDate = { gt: threeDaysLater };
        }
      }

      if (filters?.active !== undefined) {
        where.active = filters.active;
      } else {
        where.active = true;
      }

      let products = await prisma.product.findMany({
        where,
        include: { category: true, supplier: true },
        orderBy: { createdAt: "desc" },
      });

      // Post-filter for low_stock (Prisma can't compare two columns)
      if (filters?.availability === "low_stock") {
        products = products.filter((p: any) => {
          const stock = toNumber(p.stock);
          const minStock = toNumber(p.minStock);
          return stock <= minStock;
        });
      }

      return ipcSafe(products.map(serializeProduct));
    },
  );

  ipcMain.handle(
    "products:getById",
    async (_event, id: number | string, opts?: { byDbId?: boolean }) => {
      const prisma = getPrismaClient();
      const numericId = Number(id);

      // Action buttons (edit / details) pass the real DB primary key and must resolve
      // unambiguously. The default path below resolves storeProductCode first, which can
      // collide with another product's DB id — so callers with the real id pass byDbId.
      if (opts?.byDbId) {
        const product = await prisma.product.findUnique({
          where: { id: numericId },
          include: { category: true, supplier: true },
        });
        return ipcSafe(serializeProduct(product));
      }

      // Default (POS id-input / stock lookup): per-store sequential code first, fall back to global id.
      let product = !isNaN(numericId) && numericId > 0
        ? await prisma.product.findFirst({
            where: { storeProductCode: numericId, active: true },
            include: { category: true, supplier: true },
          })
        : null;
      if (!product) {
        product = await prisma.product.findUnique({
          where: { id: numericId },
          include: { category: true, supplier: true },
        });
      }
      return ipcSafe(serializeProduct(product));
    },
  );

  ipcMain.handle("products:getByBarcode", async (_event, barcode: string) => {
    const prisma = getPrismaClient();
    const product = await prisma.product.findUnique({
      where: { barcode, active: true },
      include: { category: true, supplier: true },
    });
    return ipcSafe(serializeProduct(product));
  });

  ipcMain.handle("products:search", async (_event, query: string) => {
    const prisma = getPrismaClient();
    const searchQuery = query.toLowerCase();
    const numericId = Number(searchQuery);

    const orConditions: any[] = [
      { barcode: { contains: searchQuery } },
      { nameRu: { contains: searchQuery } },
      { nameUz: { contains: searchQuery } },
      { internalCode: { contains: searchQuery } },
    ];

    if (!isNaN(numericId) && Number.isInteger(numericId) && numericId > 0) {
      orConditions.unshift({ storeProductCode: { equals: numericId } });
      orConditions.push({ id: { equals: numericId } });
    }

    const products = await prisma.product.findMany({
      where: {
        active: true,
        OR: orConditions,
      },
      include: { category: true, supplier: true },
      take: 20,
    });

    return ipcSafe(products.map(serializeProduct));
  });

  ipcMain.handle(
    "products:getTopSelling",
    async (_event, limit: number = 50) => {
      const prisma = getPrismaClient();

      // Aggregate total sold quantity per product from sale items
      const topProducts = await prisma.saleItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: limit,
      });

      const productIds: number[] = topProducts.map((p: { productId: number }) =>
        Number(p.productId),
      );

      // Fetch full product details for these IDs
      const products: { id: number; [key: string]: unknown }[] =
        await prisma.product.findMany({
          where: { id: { in: productIds }, active: true },
          include: { category: true, supplier: true },
        });

      // Sort by sales rank
      const orderMap = new Map(productIds.map((id, idx) => [id, idx]));
      products.sort(
        (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999),
      );

      return ipcSafe(products.map(serializeProduct));
    },
  );

  ipcMain.handle("products:create", async (_event, data) => {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== "ADMIN") {
      throw new Error("Unauthorized");
    }

    const prisma = getPrismaClient();

    if (!data.mxik) {
      throw new Error("MXIK code is required");
    }

    // Check if barcode already exists
    const existing = await prisma.product.findUnique({
      where: { barcode: data.barcode },
    });

    if (existing) {
      throw new Error("Product with this barcode already exists");
    }

    const storeProductCode = await getNextStoreProductCode(prisma);

    const product = await prisma.product.create({
      data: {
        barcode: data.barcode,
        nameUz: data.nameUz,
        nameRu: data.nameRu,
        price: data.price,
        cost: data.cost || null,
        stock: data.stock || 0,
        minStock: data.minStock || 0,
        unit: data.unit || "шт",
        categoryId: data.categoryId,
        supplierId: data.supplierId || null,
        productionDate: data.productionDate
          ? new Date(data.productionDate)
          : null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        discountPercent: data.discountPercent ?? 0,
        isOnPromotion: data.isOnPromotion ?? false,
        mxik: data.mxik || null,
        packageCode: data.packageCode || null,
        vatRate: data.vatRate ?? null,
        isMarked: data.isMarked ?? null,
        productType: data.productType || "REGULAR",
        internalCode: data.internalCode || null,
        storeProductCode,
        active: true,
      },
      include: { category: true, supplier: true },
    });

    return ipcSafe(serializeProduct(product));
  });

  ipcMain.handle(
    "products:update",
    async (_event, id: number | string, data) => {
      const currentUser = getCurrentUser();
      if (!currentUser || currentUser.role !== "ADMIN") {
        throw new Error("Unauthorized");
      }

      const prisma = getPrismaClient();
      const numericId = Number(id);

      // Check if barcode is being changed and if new barcode exists
      if (data.barcode) {
        const existing = await prisma.product.findFirst({
          where: {
            barcode: data.barcode,
            id: { not: numericId },
          },
        });

        if (existing) {
          throw new Error("Product with this barcode already exists");
        }
      }

      const updateData: Record<string, unknown> = {};

      if (data.barcode !== undefined) updateData.barcode = data.barcode;
      if (data.nameUz !== undefined) updateData.nameUz = data.nameUz;
      if (data.nameRu !== undefined) updateData.nameRu = data.nameRu;
      if (data.price !== undefined) updateData.price = data.price;
      if (data.cost !== undefined) updateData.cost = data.cost;
      if (data.stock !== undefined) updateData.stock = data.stock ?? 0;
      if (data.minStock !== undefined) updateData.minStock = data.minStock;
      if (data.unit !== undefined) updateData.unit = data.unit;
      if (data.categoryId !== undefined)
        updateData.categoryId = data.categoryId;
      if (data.active !== undefined) updateData.active = data.active;
      if (data.supplierId !== undefined) {
        updateData.supplierId = data.supplierId || null;
      }
      if (data.productionDate !== undefined) {
        updateData.productionDate = data.productionDate
          ? new Date(data.productionDate)
          : null;
      }
      if (data.expiryDate !== undefined) {
        updateData.expiryDate = data.expiryDate
          ? new Date(data.expiryDate)
          : null;
      }
      if (data.discountPercent !== undefined) {
        updateData.discountPercent = data.discountPercent;
      }
      if (data.isOnPromotion !== undefined) {
        updateData.isOnPromotion = data.isOnPromotion;
      }
      if (data.mxik !== undefined) {
        updateData.mxik = data.mxik || null;
      }
      if (data.packageCode !== undefined) {
        updateData.packageCode = data.packageCode || null;
      }
      if (data.vatRate !== undefined) {
        updateData.vatRate = data.vatRate ?? null;
      }
      if (data.isMarked !== undefined) {
        updateData.isMarked = data.isMarked ?? null;
      }
      if (data.productType !== undefined) {
        updateData.productType = data.productType;
      }
      if (data.internalCode !== undefined) {
        updateData.internalCode = data.internalCode || null;
      }

      const product = await prisma.product.update({
        where: { id: numericId },
        data: updateData,
        include: { category: true, supplier: true },
      });

      return ipcSafe(serializeProduct(product));
    },
  );

  ipcMain.handle("products:delete", async (_event, id: number | string) => {
    const currentUser = getCurrentUser();
    if (!currentUser || currentUser.role !== "ADMIN") {
      throw new Error("Unauthorized");
    }

    const prisma = getPrismaClient();
    const numericId = Number(id);

    // Collect sale IDs that have items for this product
    const affectedItems = await prisma.saleItem.findMany({
      where: { productId: numericId },
      select: { saleId: true },
    });
    const affectedSaleIds = [...new Set(affectedItems.map((i: { saleId: string }) => i.saleId))];

    // Remove sale items for this product
    await prisma.saleItem.deleteMany({ where: { productId: numericId } });

    // Delete sales that are now empty (no remaining items)
    if (affectedSaleIds.length > 0) {
      for (const saleId of affectedSaleIds) {
        const remaining = await prisma.saleItem.count({ where: { saleId } });
        if (remaining === 0) {
          await prisma.sale.delete({ where: { id: saleId } });
        }
      }
    }

    // Delete inventory arrivals
    await prisma.inventoryArrival.deleteMany({ where: { productId: numericId } });

    // Hard delete the product
    await prisma.product.delete({ where: { id: numericId } });

    return true;
  });

  ipcMain.handle(
    "products:findByInternalCode",
    async (_event, internalCode: string) => {
      const prisma = getPrismaClient();
      const raw = internalCode.trim();
      // Try exact match first, then zero-padded to 6 digits for numeric input
      const candidates = [raw];
      if (/^\d+$/.test(raw)) {
        candidates.push(raw.padStart(6, "0"));
      }
      let product = null;
      for (const code of candidates) {
        product = await prisma.product.findUnique({
          where: { internalCode: code },
          include: { category: true, supplier: true },
        });
        if (product) break;
      }
      return ipcSafe(serializeProduct(product));
    },
  );

  ipcMain.handle("products:getNextInternalCode", async () => {
    const prisma = getPrismaClient();
    const rows = await prisma.product.findMany({
      where: { internalCode: { not: null } },
      select: { internalCode: true },
    });
    const max = rows.reduce((acc: number, r: { internalCode: string | null }) => {
      const n = parseInt(r.internalCode ?? "0", 10);
      return n > acc ? n : acc;
    }, 0);
    return String(max + 1).padStart(6, "0");
  });

  // Product analytics API
  ipcMain.handle(
    "products:getAnalytics",
    async (_event, productId: number, startDate?: string, endDate?: string) => {
      const currentUser = getCurrentUser();
      if (!currentUser || currentUser.role !== "ADMIN") {
        throw new Error("Unauthorized");
      }

      const prisma = getPrismaClient();

      // Default to last 30 days if no dates provided
      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate
        ? new Date(startDate)
        : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Set end date to end of day
      end.setHours(23, 59, 59, 999);
      start.setHours(0, 0, 0, 0);

      // Get sale items for this product in the date range
      const saleItems = await prisma.saleItem.findMany({
        where: {
          productId,
          sale: {
            createdAt: {
              gte: start,
              lte: end,
            },
          },
        },
        include: {
          sale: true,
        },
      });

      // Get the product for cost price
      const product = await prisma.product.findUnique({
        where: { id: productId },
      });

      const costPrice = product?.cost ? toNumber(product.cost) : 0;

      // Calculate analytics
      let totalUnitsSold = 0;
      let totalRevenue = 0;
      let totalCost = 0;

      for (const item of saleItems) {
        const qty = toNumber(item.quantity);
        const subtotal = toNumber(item.subtotal);
        totalUnitsSold += qty;
        totalRevenue += subtotal;
        totalCost += qty * costPrice;
      }

      const profit = totalRevenue - totalCost;
      const profitMargin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

      // Calculate days in range
      const daysDiff = Math.ceil(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      );
      const avgDailySales = daysDiff > 0 ? totalUnitsSold / daysDiff : 0;

      // Calculate inventory value
      const currentStock = product ? toNumber(product.stock) : 0;
      const inventoryValue = currentStock * costPrice;

      return ipcSafe({
        productId,
        period: {
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          days: daysDiff,
        },
        sales: {
          totalUnitsSold,
          totalRevenue,
          totalCost,
          profit,
          profitMargin: Math.round(profitMargin * 100) / 100,
          avgDailySales: Math.round(avgDailySales * 100) / 100,
          transactionCount: saleItems.length,
        },
        inventory: {
          currentStock,
          cost: costPrice,
          inventoryValue,
        },
      });
    },
  );
}
