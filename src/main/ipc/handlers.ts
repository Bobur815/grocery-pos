import { ipcMain, app, net } from "electron";
import { setupAuthHandlers } from "./auth-handlers";
import { setupProductsHandlers } from "./products-handlers";
import { setupSalesHandlers } from "./sales-handlers";
import { setupWeighedItemsHandlers } from "./weighed-items-handlers";
import { setupScaleHandlers } from "./scale-handlers";
import { setupSmenaHandlers } from "./smena-handlers";
import { setupPaynetHandlers } from "./paynet-handlers";
import { setupMarkingCodesHandlers } from "./marking-codes-handlers";
import { setupFiscalHandlers } from "./fiscal-handlers";
import { getAppConfig, updateConfig } from "../config/app-config";
import { getAuthToken, getServerToken } from "../sync/queue-manager";
import { getPrismaClient, readStoreBootstrap, writeStoreBootstrap } from "../database/sqlite-client";
import {
  setPrinterConfig,
  setupPrinterHandlers,
} from "../printer/thermal-printer";
import { convertUzbekText } from "../../shared/utils/transliterator";
import { mapPackageNames } from "../../shared/utils/mxik-packages";

export function setupIpcHandlers(): void {
  // Setup all IPC handlers
  setupAuthHandlers();
  setupProductsHandlers();
  setupSalesHandlers();
  setupWeighedItemsHandlers();
  setupScaleHandlers();
  setupCategoriesHandlers();
  setupInventoryHandlers();
  setupSuppliersHandlers();
  setupSettingsHandlers();
  setupPrinterHandlers();
  setupSmenaHandlers();
  setupAppHandlers();
  setupReceiptHandlers();
  setupPaynetHandlers();
  setupMarkingCodesHandlers();
  setupMxikHandlers();
  setupFiscalHandlers();
}

// MXIK catalog lives only in the VPS PostgreSQL, so the renderer proxies through
// the server (with the logged-in server token) to fetch the group list.
function setupMxikHandlers(): void {
  ipcMain.handle("mxik:getGroups", async () => {
    const config = getAppConfig();
    const token = getServerToken();
    if (!token) return [];
    try {
      const response = await fetch(`${config.vpsApiUrl}/mxik/catalog/groups`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return [];
      const groups = await response.json();
      return ipcSafe(Array.isArray(groups) ? groups : []);
    } catch (error) {
      console.error("Failed to fetch MXIK groups:", error instanceof Error ? error.message : error);
      return [];
    }
  });

  // Look up a product's MXIK + name by barcode via tasnif.soliq.uz (main process — no
  // browser CORS; terminal is in UZ). Mirrors the web client's mxik.searchByBarcode so the
  // renderer can auto-fill MXIK on barcode entry the same way the web ProductForm does.
  ipcMain.handle("mxik:lookupByBarcode", async (_event, barcode: string) => {
    const bc = (barcode || "").trim();
    if (!bc) return null;
    const TASNIF = "https://tasnif.soliq.uz/api/cls-api";
    try {
      const searchRes = await fetch(
        `${TASNIF}/elasticsearch/search?lang=uz_cyrl&search=${encodeURIComponent(bc)}&size=5&page=0`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!searchRes.ok) return null;
      const searchJson = (await searchRes.json()) as {
        success?: boolean;
        data?: Array<{ mxikCode: string; internationalCode?: string }>;
      };
      if (!searchJson?.success || !searchJson.data?.length) return null;
      const match = searchJson.data.find((d) => d.internationalCode === bc) ?? searchJson.data[0];

      const detailRes = await fetch(`${TASNIF}/integration-mxik/get/history/${match.mxikCode}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!detailRes.ok) return null;
      const detailJson = (await detailRes.json()) as {
        data?: {
          mxikCode: string;
          brandName?: string | null;
          attributeNameUz?: string | null;
          attributeNameRu?: string | null;
          subPositionNameUz?: string | null;
          subPositionNameRu?: string | null;
        };
      };
      const d = detailJson?.data;
      if (!d) return null;
      const brand = d.brandName ? `${d.brandName} ` : "";
      return ipcSafe({
        code: d.mxikCode,
        name: brand + (d.attributeNameUz ?? d.subPositionNameUz ?? ""),
        nameRu: brand + (d.attributeNameRu ?? d.subPositionNameRu ?? ""),
      });
    } catch (error) {
      console.error("mxik:lookupByBarcode failed:", error instanceof Error ? error.message : error);
      return null;
    }
  });

  // Package (unit) codes for an MXIK — fetched from tasnif.soliq.uz directly. Done in the
  // main process (no browser CORS) and the terminal is in Uzbekistan, so tasnif is reachable.
  ipcMain.handle("mxik:getPackages", async (_event, mxikCode: string) => {
    if (!/^\d{17}$/.test(mxikCode || "")) return [];
    try {
      const response = await fetch(
        `https://tasnif.soliq.uz/api/cls-api/integration-mxik/get/history/${mxikCode}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!response.ok) return [];
      const json = (await response.json()) as { data?: { packageNames?: unknown } };
      return ipcSafe(mapPackageNames(json?.data?.packageNames));
    } catch (error) {
      console.error("Failed to fetch MXIK packages:", error instanceof Error ? error.message : error);
      return [];
    }
  });

  // Search the MXIK catalog by product name for the picker — queries tasnif.soliq.uz directly
  // (main process: no browser CORS, terminal is in UZ). Mirrors the web client's mxik.catalogSearch
  // so the renderer ProductForm can offer the same searchable MXIK picker. Paginated.
  ipcMain.handle(
    "mxik:catalogSearch",
    async (_event, q: string, page = 0, size = 10): Promise<{ results: unknown[]; total: number }> => {
      const query = (q || "").trim();
      if (query.length < 2) return { results: [], total: 0 };
      try {
        const url = `https://tasnif.soliq.uz/api/cls-api/elasticsearch/search?lang=uz_cyrl&search=${encodeURIComponent(query)}&size=${size}&page=${page}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return { results: [], total: 0 };
        const json = (await res.json()) as {
          data?: Array<Record<string, unknown>>;
          recordTotal?: number;
        };
        const results = (json.data ?? []).map((item) => ({
          mxikCode: item.mxikCode,
          mxikName: item.name,
          groupCode: item.groupCode,
          groupName: item.groupName,
          classCode: item.classCode,
          className: item.className,
          internationalCode: item.internationalCode ?? null,
          unitName: item.unitsName ?? item.packageName ?? null,
        }));
        return ipcSafe({ results, total: json.recordTotal ?? 0 });
      } catch (error) {
        console.error("mxik:catalogSearch failed:", error instanceof Error ? error.message : error);
        return { results: [], total: 0 };
      }
    },
  );
}

function setupCategoriesHandlers(): void {
  ipcMain.handle("categories:getAll", async () => {
    const prisma = getPrismaClient();
    return prisma.category.findMany({
      where: { active: true },
      orderBy: { nameRu: "asc" },
    });
  });

  // Top categories by total quantity sold — used by the POS catalog quick-filter buttons.
  ipcMain.handle("categories:getTopSelling", async (_event, limit: number = 5) => {
    const prisma = getPrismaClient();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT c.id as id, c.name_ru as nameRu, c.name_uz as nameUz,
              CAST(SUM(si.quantity) AS REAL) as quantity
       FROM sale_items si
       JOIN products p ON si.product_id = p.id
       JOIN categories c ON p.category_id = c.id
       WHERE c.active = 1
       GROUP BY c.id
       ORDER BY quantity DESC
       LIMIT ?`,
      limit,
    )) as { id: number | bigint; nameRu: string; nameUz: string }[];
    return rows.map((r) => ({
      id: Number(r.id),
      nameRu: String(r.nameRu || ""),
      nameUz: String(r.nameUz || ""),
    }));
  });

  ipcMain.handle("categories:create", async (_event, data) => {
    const prisma = getPrismaClient();
    return prisma.category.create({ data });
  });

  ipcMain.handle("categories:update", async (_event, id: string, data) => {
    const prisma = getPrismaClient();
    return prisma.category.update({
      where: { id: Number(id) },
      data,
    });
  });

  ipcMain.handle("categories:delete", async (_event, id: string) => {
    const prisma = getPrismaClient();
    await prisma.category.update({
      where: { id: Number(id) },
      data: { active: false },
    });
    return true;
  });
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

function ipcSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function serializeSupplier(supplier: any) {
  if (!supplier) return null;
  return {
    id: supplier.id,
    nameRu: supplier.nameRu,
    nameUz: supplier.nameUz,
    phone: supplier.phone || undefined,
    address: supplier.address || undefined,
    active: Boolean(supplier.active),
    balance: toNumber(supplier.balance),
    paymentType: supplier.paymentType ?? 'IMMEDIATE',
    createdAt: supplier.createdAt?.toISOString?.() || supplier.createdAt,
  };
}

function serializeTransaction(tx: any) {
  if (!tx) return null;
  return {
    id: tx.id,
    supplierId: tx.supplierId,
    supplier: tx.supplier ? serializeSupplier(tx.supplier) : undefined,
    type: tx.type,
    paymentMethod: tx.paymentMethod,
    amount: toNumber(tx.amount),
    description: tx.description || undefined,
    referenceId: tx.referenceId || undefined,
    referenceType: tx.referenceType || undefined,
    dueDate: tx.dueDate?.toISOString?.() || tx.dueDate || undefined,
    paidAt: tx.paidAt?.toISOString?.() || tx.paidAt || undefined,
    createdBy: tx.createdBy,
    createdAt: tx.createdAt?.toISOString?.() || tx.createdAt,
    updatedAt: tx.updatedAt?.toISOString?.() || tx.updatedAt,
  };
}

function setupSuppliersHandlers(): void {
  // Get all suppliers
  ipcMain.handle(
    "suppliers:getAll",
    async (_event, includeInactive?: boolean) => {
      const prisma = getPrismaClient();
      const where = includeInactive ? {} : { active: true };
      const suppliers = await prisma.supplier.findMany({
        where,
        orderBy: { nameRu: "asc" },
      });
      return ipcSafe(suppliers.map(serializeSupplier));
    },
  );

  // Get supplier by ID with transactions
  ipcMain.handle("suppliers:getById", async (_event, id: string) => {
    const prisma = getPrismaClient();
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        transactions: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    });
    if (!supplier) return null;

    const serialized = serializeSupplier(supplier);
    return ipcSafe({
      ...serialized,
      transactions: supplier.transactions.map(serializeTransaction),
    });
  });

  // Create supplier
  ipcMain.handle(
    "suppliers:create",
    async (
      _event,
      data: {
        nameRu: string;
        nameUz: string;
        phone?: string;
        address?: string;
        balance?: number;
        paymentType?: string;
      },
    ) => {
      const prisma = getPrismaClient();
      const supplier = await prisma.supplier.create({
        data: {
          nameRu: data.nameRu,
          nameUz: data.nameUz,
          phone: data.phone || null,
          address: data.address || null,
          balance: data.balance ?? 0,
          paymentType: data.paymentType ?? 'IMMEDIATE',
        },
      });
      return ipcSafe(serializeSupplier(supplier));
    },
  );

  // Update supplier
  ipcMain.handle(
    "suppliers:update",
    async (
      _event,
      id: string,
      data: {
        nameRu?: string;
        nameUz?: string;
        phone?: string;
        address?: string;
        active?: boolean;
        balance?: number;
        paymentType?: string;
      },
    ) => {
      const prisma = getPrismaClient();
      const supplier = await prisma.supplier.update({
        where: { id },
        data: {
          ...(data.nameRu !== undefined && { nameRu: data.nameRu }),
          ...(data.nameUz !== undefined && { nameUz: data.nameUz }),
          ...(data.phone !== undefined && { phone: data.phone || null }),
          ...(data.address !== undefined && { address: data.address || null }),
          ...(data.active !== undefined && { active: data.active }),
          ...(data.balance !== undefined && { balance: data.balance }),
          ...(data.paymentType !== undefined && { paymentType: data.paymentType }),
        },
      });
      return ipcSafe(serializeSupplier(supplier));
    },
  );

  // Delete supplier: hard delete if no arrivals/transactions, soft delete otherwise
  ipcMain.handle("suppliers:delete", async (_event, id: string) => {
    const prisma = getPrismaClient();

    const arrivalsCount = await prisma.inventoryArrival.count({ where: { supplierId: id } });
    const txCount = await prisma.supplierTransaction.count({ where: { supplierId: id } });

    if (arrivalsCount === 0 && txCount === 0) {
      await prisma.supplier.delete({ where: { id } });
    } else {
      await prisma.supplier.update({ where: { id }, data: { active: false } });
    }
    return true;
  });

  // Get transactions for a supplier
  ipcMain.handle(
    "suppliers:getTransactions",
    async (
      _event,
      filters: {
        supplierId?: string;
        type?: string;
        paymentMethod?: string;
        startDate?: string;
        endDate?: string;
      },
    ) => {
      const prisma = getPrismaClient();
      const where: Record<string, unknown> = {};

      if (filters.supplierId) where.supplierId = filters.supplierId;
      if (filters.type) where.type = filters.type;
      if (filters.paymentMethod) where.paymentMethod = filters.paymentMethod;

      if (filters.startDate || filters.endDate) {
        where.createdAt = {};
        if (filters.startDate)
          (where.createdAt as Record<string, Date>).gte = new Date(
            filters.startDate,
          );
        if (filters.endDate) {
          const endDate = new Date(filters.endDate);
          endDate.setHours(23, 59, 59, 999);
          (where.createdAt as Record<string, Date>).lte = endDate;
        }
      }

      const transactions = await prisma.supplierTransaction.findMany({
        where,
        include: { supplier: true },
        orderBy: { createdAt: "desc" },
      });

      return ipcSafe(transactions.map(serializeTransaction));
    },
  );

  // Create transaction and update supplier balance
  ipcMain.handle(
    "suppliers:createTransaction",
    async (
      _event,
      data: {
        supplierId: string;
        type: string;
        paymentMethod: string;
        amount: number;
        description?: string;
        referenceId?: string;
        referenceType?: string;
        dueDate?: string;
        createdBy: string;
      },
    ) => {
      const prisma = getPrismaClient();

      // Determine balance change based on transaction type
      // PURCHASE: negative (we owe more)
      // PAYMENT, RETURN: positive (we owe less)
      // ADVANCE: positive (they owe us)
      // ADJUSTMENT: use amount as-is
      let balanceChange = data.amount;
      if (data.type === "PURCHASE") {
        balanceChange = -Math.abs(data.amount); // Always negative
      } else if (["PAYMENT", "RETURN", "ADVANCE"].includes(data.type)) {
        balanceChange = Math.abs(data.amount); // Always positive
      }
      // ADJUSTMENT uses the amount as provided (can be + or -)

      const transaction = await prisma.supplierTransaction.create({
        data: {
          supplierId: data.supplierId,
          type: data.type,
          paymentMethod: data.paymentMethod,
          amount: balanceChange,
          description: data.description || null,
          referenceId: data.referenceId || null,
          referenceType: data.referenceType || null,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          paidAt: ["PAYMENT", "ADVANCE"].includes(data.type)
            ? new Date()
            : null,
          createdBy: data.createdBy,
        },
        include: { supplier: true },
      });

      // Update supplier balance
      await prisma.supplier.update({
        where: { id: data.supplierId },
        data: {
          balance: { increment: balanceChange },
        },
      });

      return ipcSafe(serializeTransaction(transaction));
    },
  );

  // Update transaction
  ipcMain.handle(
    "suppliers:updateTransaction",
    async (
      _event,
      id: string,
      data: {
        type?: string;
        paymentMethod?: string;
        amount?: number;
        description?: string;
        dueDate?: string;
        paidAt?: string;
      },
    ) => {
      const prisma = getPrismaClient();

      // Get original transaction to calculate balance difference
      const original = await prisma.supplierTransaction.findUnique({
        where: { id },
      });
      if (!original) throw new Error("Transaction not found");

      const oldAmount = toNumber(original.amount);
      const newAmount = data.amount !== undefined ? data.amount : oldAmount;
      const balanceDiff = newAmount - oldAmount;

      const transaction = await prisma.supplierTransaction.update({
        where: { id },
        data: {
          ...(data.type !== undefined && { type: data.type }),
          ...(data.paymentMethod !== undefined && {
            paymentMethod: data.paymentMethod,
          }),
          ...(data.amount !== undefined && { amount: data.amount }),
          ...(data.description !== undefined && {
            description: data.description || null,
          }),
          ...(data.dueDate !== undefined && {
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
          }),
          ...(data.paidAt !== undefined && {
            paidAt: data.paidAt ? new Date(data.paidAt) : null,
          }),
        },
        include: { supplier: true },
      });

      // Update supplier balance if amount changed
      if (balanceDiff !== 0) {
        await prisma.supplier.update({
          where: { id: original.supplierId },
          data: {
            balance: { increment: balanceDiff },
          },
        });
      }

      return ipcSafe(serializeTransaction(transaction));
    },
  );

  // Delete transaction and reverse balance
  ipcMain.handle("suppliers:deleteTransaction", async (_event, id: string) => {
    const prisma = getPrismaClient();

    const transaction = await prisma.supplierTransaction.findUnique({
      where: { id },
    });
    if (!transaction) throw new Error("Transaction not found");

    // Reverse the balance change
    const amount = toNumber(transaction.amount);
    await prisma.supplier.update({
      where: { id: transaction.supplierId },
      data: {
        balance: { decrement: amount },
      },
    });

    await prisma.supplierTransaction.delete({ where: { id } });

    return true;
  });

  // Get supplier balance summary
  ipcMain.handle("suppliers:getBalance", async (_event, supplierId: string) => {
    const prisma = getPrismaClient();

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) return null;

    // Get transaction summary
    const transactions = await prisma.supplierTransaction.findMany({
      where: { supplierId },
    });

    let totalDebt = 0; // What we owe (sum of negative)
    let totalCredit = 0; // What they owe us (sum of positive)

    for (const tx of transactions) {
      const amount = toNumber(tx.amount);
      if (amount < 0) totalDebt += Math.abs(amount);
      else totalCredit += amount;
    }

    return ipcSafe({
      balance: toNumber(supplier.balance),
      totalDebt,
      totalCredit,
    });
  });

  // Record payment shortcut
  ipcMain.handle(
    "suppliers:recordPayment",
    async (
      _event,
      data: {
        supplierId: string;
        amount: number;
        paymentMethod: string;
        description?: string;
        createdBy: string;
      },
    ) => {
      const prisma = getPrismaClient();

      const transaction = await prisma.supplierTransaction.create({
        data: {
          supplierId: data.supplierId,
          type: "PAYMENT",
          paymentMethod: data.paymentMethod,
          amount: Math.abs(data.amount), // Positive = reduces our debt
          description: data.description || null,
          paidAt: new Date(),
          createdBy: data.createdBy,
        },
      });

      await prisma.supplier.update({
        where: { id: data.supplierId },
        data: {
          balance: { increment: Math.abs(data.amount) },
        },
      });

      return ipcSafe(serializeTransaction(transaction));
    },
  );
}

function setupInventoryHandlers(): void {
  ipcMain.handle("inventory:createArrival", async (_event, data) => {
    const prisma = getPrismaClient();

    const cost = data.cost ?? 0;
    const totalCost = data.quantity * cost;

    // Create arrival record
    const arrival = await prisma.inventoryArrival.create({
      data: {
        productId: data.productId,
        quantity: data.quantity,
        cost,
        totalCost,
        supplierId: data.supplierId || null,
        notes: data.notes || null,
        createdBy: data.createdBy,
      },
    });

    // Update product stock; only update cost if provided
    const productUpdate: Record<string, unknown> = {
      stock: { increment: data.quantity },
      ...(data.cost != null && { cost: data.cost }),
    };

    if (data.newPrice !== undefined && data.priceMode) {
      if (data.priceMode === "immediate") {
        // Change price immediately for all stock
        productUpdate.price = data.newPrice;
        productUpdate.pendingPrice = null;
        productUpdate.pendingPriceThreshold = null;
      } else if (data.priceMode === "deferred") {
        // Apply new price after old stock is sold (when stock drops to new arrival qty)
        productUpdate.pendingPrice = data.newPrice;
        productUpdate.pendingPriceThreshold = data.quantity;
      }
    }

    // Update production/expiry dates if provided
    if (data.productionDate !== undefined) {
      productUpdate.productionDate = data.productionDate
        ? new Date(data.productionDate)
        : null;
    }
    if (data.expiryDate !== undefined) {
      productUpdate.expiryDate = data.expiryDate
        ? new Date(data.expiryDate)
        : null;
    }

    await prisma.product.update({
      where: { id: data.productId },
      data: productUpdate,
    });

    // If supplier is specified, create a supplier transaction (PURCHASE type)
    if (data.supplierId && data.createdBy) {
      const paymentMethod = data.paymentMethod || "CASH";
      // Immediate payment methods don't create debt; only credit-based methods affect balance
      const isImmediatePayment = ["CASH", "CARD", "BANK_TRANSFER"].includes(
        paymentMethod,
      );
      const balanceChange = isImmediatePayment ? 0 : -Math.abs(totalCost);

      await prisma.supplierTransaction.create({
        data: {
          supplierId: data.supplierId,
          type: "PURCHASE",
          paymentMethod,
          amount: balanceChange,
          description: data.notes || null,
          referenceId: arrival.id,
          referenceType: "INVENTORY_ARRIVAL",
          createdBy: data.createdBy,
        },
      });

      // Only update balance for credit-based purchases (INSTALLMENT, ONE_TO_ONE)
      if (!isImmediatePayment) {
        await prisma.supplier.update({
          where: { id: data.supplierId },
          data: {
            balance: { increment: balanceChange },
          },
        });
      }
    }

    return ipcSafe(arrival);
  });

  ipcMain.handle("inventory:getArrivals", async (_event, filters) => {
    const prisma = getPrismaClient();

    const where: Record<string, unknown> = {};
    if (filters?.productId) {
      where.productId = filters.productId;
    }

    const arrivals = await prisma.inventoryArrival.findMany({
      where,
      include: {
        product: true,
        supplier: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return ipcSafe(arrivals);
  });

  ipcMain.handle("inventory:getLowStock", async () => {
    const prisma = getPrismaClient();
    // Fetch products where stock <= minStock using raw query for column comparison
    const products = await prisma.$queryRaw`
      SELECT p.*, c.name_uz as category_name_uz, c.name_ru as category_name_ru
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1 AND p.stock <= p.min_stock
      ORDER BY p.stock ASC
    `;
    return products;
  });
}

function setupSettingsHandlers(): void {
  ipcMain.handle("settings:get", async (_event, key: string) => {
    const prisma = getPrismaClient();
    const setting = await prisma.systemSetting.findUnique({
      where: { key },
    });
    return setting?.value || null;
  });

  ipcMain.handle("settings:set", async (_event, key: string, value: string) => {
    const prisma = getPrismaClient();
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
    if (key === "printer_name") {
      setPrinterConfig({ name: value });
    }
  });

  ipcMain.handle("settings:getAll", async () => {
    const prisma = getPrismaClient();
    const settings = await prisma.systemSetting.findMany();
    const result: Record<string, string> = {};
    for (const setting of settings) {
      result[setting.key] = setting.value;
    }
    return result;
  });

  // Load saved printer name on startup
  getPrismaClient()
    .systemSetting.findUnique({ where: { key: "printer_name" } })
    .then((setting: { value: string } | null) => {
      if (setting?.value) {
        setPrinterConfig({ name: setting.value });
      }
    })
    .catch(() => {});
}

function setupAppHandlers(): void {
  const config = getAppConfig();

  ipcMain.handle("app:getVersion", () => {
    return app.getVersion();
  });

  ipcMain.handle("app:isOnline", () => {
    return new Promise<boolean>((resolve) => {
      const req = net.request({ method: "HEAD", url: "https://pos.bobur-dev.uz" });
      const timer = setTimeout(() => { req.abort(); resolve(false); }, 3000);
      req.on("response", () => { clearTimeout(timer); resolve(true); });
      req.on("error", () => { clearTimeout(timer); resolve(false); });
      req.end();
    });
  });

  ipcMain.handle("app:getTerminalId", () => {
    return config.terminalId;
  });

  ipcMain.handle("app:getStoreInfo", () => {
    return {
      storeId: config.storeId,
      storeName: config.storeName,
    };
  });

  ipcMain.handle("app:quit", () => {
    app.quit();
  });

  ipcMain.handle("app:relaunch", () => {
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  });

  ipcMain.handle("config:getLocalConfig", async () => {
    const prisma = getPrismaClient();
    return prisma.localConfig.findUnique({ where: { id: "config" } });
  });

  ipcMain.handle(
    "config:updateLocalConfig",
    async (_event, data: { storeId?: string; apiUrl?: string; storeName?: string; terminalId?: string }) => {
      const prisma = getPrismaClient();
      const result = await prisma.localConfig.update({
        where: { id: "config" },
        data,
      });
      if (data.terminalId) updateConfig({ terminalId: data.terminalId });
      if (data.storeId) updateConfig({ storeId: data.storeId });
      if (data.apiUrl) updateConfig({ vpsApiUrl: data.apiUrl });

      // When storeId changes, write the bootstrap file so the next launch
      // opens the correct per-store SQLite database.
      let requiresRestart = false;
      if (data.storeId) {
        const current = readStoreBootstrap();
        if (current !== data.storeId) {
          writeStoreBootstrap(data.storeId);
          requiresRestart = true;
        }
      }

      return { ...result, requiresRestart };
    },
  );
}

function setupReceiptHandlers(): void {
  ipcMain.handle(
    "receipt:scan",
    async (_event, imageBase64: string, mimeType: string) => {
      const prisma = getPrismaClient();
      const config = getAppConfig();

      // Delegate scanning to the NestJS server (API key is managed server-side)
      // Use the server-issued token (obtained during login); local token won't work server-side
      const token = getServerToken();
      if (!token) {
        throw new Error("NOT_AUTHENTICATED");
      }

      const response = await fetch(`${config.vpsApiUrl}/invoice/scan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ imageBase64, mimeType }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Invoice scan API error:", response.status, errorBody);
        throw new Error(`API error: ${response.status}`);
      }

      const result = (await response.json()) as {
        supplierName: string | null;
        receiptDate: string | null;
        items: unknown[];
        tier: string;
        cost_usd?: number;
        balance_uzs?: number;
      };

      // Cache updated balance locally if server returned it
      if (typeof result.balance_uzs === "number") {
        await prisma.systemSetting.upsert({
          where: { key: "ai_balance_uzs" },
          update: { value: String(result.balance_uzs) },
          create: { key: "ai_balance_uzs", value: String(result.balance_uzs) },
        });
      }

      return ipcSafe(result);
    },
  );

  // Fetches the store plan + credit balance from the server and caches locally
  ipcMain.handle("receipt:getPlan", async () => {
    const prisma = getPrismaClient();
    const config = getAppConfig();
    try {
      const token = getServerToken();
      if (!token) return { plan: "free", balance_uzs: null };

      const response = await fetch(`${config.vpsApiUrl}/invoice/plan`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = (await response.json()) as {
        plan: string;
        balance_uzs: number | null;
      };
      // Cache locally so the UI shows it even offline
      await prisma.systemSetting.upsert({
        where: { key: "ai_plan" },
        update: { value: data.plan },
        create: { key: "ai_plan", value: data.plan },
      });
      if (typeof data.balance_uzs === "number") {
        await prisma.systemSetting.upsert({
          where: { key: "ai_balance_uzs" },
          update: { value: String(data.balance_uzs) },
          create: { key: "ai_balance_uzs", value: String(data.balance_uzs) },
        });
      }
      return data;
    } catch {
      // Fallback to cached values
      const [planSetting, balanceSetting] = await Promise.all([
        prisma.systemSetting.findUnique({ where: { key: "ai_plan" } }),
        prisma.systemSetting.findUnique({ where: { key: "ai_balance_uzs" } }),
      ]);
      return {
        plan: planSetting?.value ?? "free",
        balance_uzs: balanceSetting ? parseFloat(balanceSetting.value) : null,
      };
    }
  });

  // Returns the cached credit balance for the pro plan UI
  ipcMain.handle("receipt:getScanUsage", async () => {
    const prisma = getPrismaClient();
    const balanceSetting = await prisma.systemSetting.findUnique({
      where: { key: "ai_balance_uzs" },
    });
    const balance_uzs = balanceSetting
      ? parseFloat(balanceSetting.value)
      : null;
    return { balance_uzs };
  });

  ipcMain.handle(
    "receipt:matchProducts",
    async (_event, items: { name: string; mxik?: string | null }[]) => {
      const prisma = getPrismaClient();
      const matches = [];

      for (const item of items) {
        const name = item.name;
        const mxik = item.mxik?.trim() || null;
        const nameLower = name.toLowerCase().trim();
        const transliterated = convertUzbekText(nameLower);

        type ProductRow = { id: string; name_ru: string; name_uz: string };

        // ── 1. MXIK exact match (highest confidence) ─────────────────────────
        if (mxik) {
          const byMxik = (await prisma.$queryRawUnsafe(
            `SELECT id, name_ru, name_uz FROM products WHERE active = 1 AND mxik = ? LIMIT 1`,
            mxik,
          )) as ProductRow[];

          if (byMxik.length > 0) {
            matches.push({
              scannedName: name,
              matchedProductId: String(byMxik[0].id),
              matchedProductNameRu: byMxik[0].name_ru,
              matchedProductNameUz: byMxik[0].name_uz,
              confidence: "exact" as const,
            });
            continue;
          }
        }

        // ── 2. Name exact match ───────────────────────────────────────────────
        let products = (await prisma.$queryRawUnsafe(
          `SELECT id, name_ru, name_uz FROM products WHERE active = 1 AND (LOWER(name_ru) = ? OR LOWER(name_uz) = ? OR LOWER(name_ru) = ? OR LOWER(name_uz) = ?) LIMIT 1`,
          nameLower,
          nameLower,
          transliterated,
          transliterated,
        )) as ProductRow[];

        if (products.length > 0) {
          matches.push({
            scannedName: name,
            matchedProductId: String(products[0].id),
            matchedProductNameRu: products[0].name_ru,
            matchedProductNameUz: products[0].name_uz,
            confidence: "high" as const,
          });
          continue;
        }

        // ── 3. Name substring match ───────────────────────────────────────────
        products = (await prisma.$queryRawUnsafe(
          `SELECT id, name_ru, name_uz FROM products WHERE active = 1 AND (LOWER(name_ru) LIKE ? OR LOWER(name_uz) LIKE ? OR LOWER(name_ru) LIKE ? OR LOWER(name_uz) LIKE ?) LIMIT 1`,
          `%${nameLower}%`,
          `%${nameLower}%`,
          `%${transliterated}%`,
          `%${transliterated}%`,
        )) as ProductRow[];

        if (products.length > 0) {
          matches.push({
            scannedName: name,
            matchedProductId: String(products[0].id),
            matchedProductNameRu: products[0].name_ru,
            matchedProductNameUz: products[0].name_uz,
            confidence: "medium" as const,
          });
          continue;
        }

        // ── 4. First-word partial match ───────────────────────────────────────
        const firstWord = nameLower.split(/\s+/)[0];
        const firstWordTranslit = convertUzbekText(firstWord);
        if (firstWord.length >= 3) {
          products = (await prisma.$queryRawUnsafe(
            `SELECT id, name_ru, name_uz FROM products WHERE active = 1 AND (LOWER(name_ru) LIKE ? OR LOWER(name_uz) LIKE ? OR LOWER(name_ru) LIKE ? OR LOWER(name_uz) LIKE ?) LIMIT 1`,
            `%${firstWord}%`,
            `%${firstWord}%`,
            `%${firstWordTranslit}%`,
            `%${firstWordTranslit}%`,
          )) as ProductRow[];

          if (products.length > 0) {
            matches.push({
              scannedName: name,
              matchedProductId: String(products[0].id),
              matchedProductNameRu: products[0].name_ru,
              matchedProductNameUz: products[0].name_uz,
              confidence: "low" as const,
            });
            continue;
          }
        }

        // ── 5. No match ───────────────────────────────────────────────────────
        matches.push({
          scannedName: name,
          matchedProductId: null,
          matchedProductNameRu: null,
          matchedProductNameUz: null,
          confidence: "none" as const,
        });
      }

      return ipcSafe(matches);
    },
  );
}
