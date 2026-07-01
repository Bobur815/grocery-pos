import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { ProductFilters, ProductWhereInput } from "./types/product.types";

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(storeId: string, filters?: ProductFilters) {
    const where: ProductWhereInput = { storeId };

    if (filters?.categoryId) where.categoryId = filters.categoryId;
    if (filters?.active !== undefined) where.active = filters.active;
    if (filters?.updatedAfter) {
      where.updatedAt = { gt: filters.updatedAfter };
    }

    return this.prisma.product.findMany({
      where,
      include: { category: true, supplier: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findById(id: number, storeId: string, byDbId = false) {
    // Action buttons (edit / details) pass the real DB primary key and must resolve
    // unambiguously. The default path below resolves storeProductCode first, which can
    // collide with another product's DB id — so callers with the real id pass byDbId.
    if (byDbId) {
      const product = await this.prisma.product.findUnique({
        where: { id },
        include: { category: true, supplier: true },
      });

      if (!product || product.storeId !== storeId) {
        throw new NotFoundException("Product not found");
      }

      return product;
    }

    // Default (POS id-input / stock lookup): per-store sequential code first, fall back to global id.
    let product =
      id > 0
        ? await this.prisma.product.findFirst({
            where: { storeId, storeProductCode: id, active: true },
            include: { category: true, supplier: true },
          })
        : null;

    if (!product) {
      product = await this.prisma.product.findUnique({
        where: { id },
        include: { category: true, supplier: true },
      });
    }

    if (!product || product.storeId !== storeId) {
      throw new NotFoundException("Product not found");
    }

    return product;
  }

  async findByBarcode(storeId: string, barcode: string) {
    return this.prisma.product.findUnique({
      where: { storeId_barcode: { storeId, barcode } },
      include: { category: true, supplier: true },
    });
  }

  async findByInternalCode(storeId: string, internalCode: string) {
    const raw = internalCode.trim();
    const candidates = [raw];
    if (/^\d+$/.test(raw)) {
      candidates.push(raw.padStart(6, '0'));
    }
    for (const code of candidates) {
      const product = await this.prisma.product.findFirst({
        where: { storeId, internalCode: code },
        include: { category: true, supplier: true },
      });
      if (product) return product;
    }
    return null;
  }

  async getNextInternalCode(storeId: string): Promise<string> {
    const rows = await this.prisma.product.findMany({
      where: { storeId, internalCode: { not: null } },
      select: { internalCode: true },
    });
    const max = rows.reduce((acc, r) => {
      const n = parseInt(r.internalCode ?? '0', 10);
      return n > acc ? n : acc;
    }, 0);
    return String(max + 1).padStart(6, '0');
  }

  async search(storeId: string, query: string) {
    const searchQuery = query.toLowerCase();

    return this.prisma.product.findMany({
      where: {
        storeId,
        active: true,
        OR: [
          { barcode: { contains: searchQuery } },
          { nameRu: { contains: searchQuery, mode: "insensitive" } },
          { nameUz: { contains: searchQuery, mode: "insensitive" } },
          { internalCode: { contains: searchQuery } },
        ],
      },
      include: { category: true, supplier: true },
      take: 20,
    });
  }

  /**
   * Next per-store product code. The renderer shows/looks-up products as
   * `storeProductCode ?? id`, so any product WITHOUT a code is displayed by its
   * global `id`. To stop a new code from colliding with one of those ids, the
   * code must sit above BOTH the highest existing code and the highest id among
   * un-coded products in this store. A fresh store has no un-coded products, so
   * it still starts cleanly at 1; this (grandfathered) store jumps past its id
   * range instead.
   */
  private async getNextStoreProductCode(storeId: string): Promise<number> {
    const [codeAgg, uncodedIdAgg] = await Promise.all([
      this.prisma.product.aggregate({
        where: { storeId },
        _max: { storeProductCode: true },
      }),
      this.prisma.product.aggregate({
        where: { storeId, storeProductCode: null },
        _max: { id: true },
      }),
    ]);
    const maxCode = codeAgg._max.storeProductCode ?? 0;
    const maxUncodedId = uncodedIdAgg._max.id ?? 0;
    return Math.max(maxCode, maxUncodedId) + 1;
  }

  async create(storeId: string, createProductDto: CreateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { storeId, barcode: createProductDto.barcode, active: true },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        "Product with this barcode already exists in this store",
      );
    }

    const nextCode = await this.getNextStoreProductCode(storeId);

    return this.prisma.product.create({
      data: {
        storeId,
        barcode: createProductDto.barcode,
        nameUz: createProductDto.nameUz,
        nameRu: createProductDto.nameRu,
        price: createProductDto.price,
        cost: createProductDto.cost,
        stock: createProductDto.stock || 0,
        minStock: createProductDto.minStock || 0,
        unit: createProductDto.unit || "шт",
        categoryId: createProductDto.categoryId,
        supplierId: createProductDto.supplierId,
        productionDate: createProductDto.productionDate
          ? new Date(createProductDto.productionDate)
          : undefined,
        expiryDate: createProductDto.expiryDate
          ? new Date(createProductDto.expiryDate)
          : undefined,
        discountPercent: createProductDto.discountPercent ?? 0,
        isOnPromotion: createProductDto.isOnPromotion ?? false,
        active: createProductDto.active ?? true,
        mxik: createProductDto.mxik,
        packageCode: createProductDto.packageCode,
        vatRate: createProductDto.vatRate,
        isMarked: createProductDto.isMarked ?? null,
        productType: createProductDto.productType ?? 'REGULAR',
        internalCode: createProductDto.internalCode,
        bulkQuantity: createProductDto.bulkQuantity ?? 0,
        minSaleQty: createProductDto.minSaleQty ?? 0,
        maxSaleQty: createProductDto.maxSaleQty ?? 0,
        storeProductCode: nextCode,
      },
      include: { category: true },
    });
  }

  async update(
    id: number,
    storeId: string,
    updateProductDto: UpdateProductDto,
  ) {
    await this.findById(id, storeId);

    if (updateProductDto.barcode) {
      const existing = await this.prisma.product.findFirst({
        where: {
          storeId,
          barcode: updateProductDto.barcode,
          active: true,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException(
          "Product with this barcode already exists in this store",
        );
      }
    }

    const { productionDate, expiryDate, ...rest } = updateProductDto;
    return this.prisma.product.update({
      where: { id },
      data: {
        ...rest,
        ...(productionDate !== undefined && {
          productionDate: productionDate ? new Date(productionDate) : null,
        }),
        ...(expiryDate !== undefined && {
          expiryDate: expiryDate ? new Date(expiryDate) : null,
        }),
      },
      include: { category: true },
    });
  }

  async hardDelete(id: number, storeId: string) {
    await this.findById(id, storeId);

    // Collect sale IDs that have items for this product
    const affectedItems = await this.prisma.saleItem.findMany({
      where: { productId: id },
      select: { saleId: true },
    });
    const affectedSaleIds = [...new Set(affectedItems.map((i) => i.saleId))];

    // Remove sale items for this product
    await this.prisma.saleItem.deleteMany({ where: { productId: id } });

    // Delete sales that are now empty (no remaining items)
    if (affectedSaleIds.length > 0) {
      await this.prisma.sale.deleteMany({
        where: { id: { in: affectedSaleIds }, items: { none: {} } },
      });
    }

    // Delete inventory arrivals
    await this.prisma.inventoryArrival.deleteMany({ where: { productId: id } });

    // Hard delete the product
    await this.prisma.product.delete({ where: { id } });

    return { success: true };
  }

  async updateStock(id: number, storeId: string, quantity: number) {
    await this.findById(id, storeId);

    const updated = await this.prisma.product.update({
      where: { id },
      data: { stock: { increment: quantity } },
    });

    // Clamp to 0 if the increment pushed stock negative
    if (Number(updated.stock) < 0) {
      return this.prisma.product.update({
        where: { id },
        data: { stock: 0 },
      });
    }

    return updated;
  }

  async getAnalytics(
    id: number,
    storeId: string,
    startDate: Date,
    endDate: Date,
  ) {
    const product = await this.findById(id, storeId);

    const saleItems = await this.prisma.saleItem.findMany({
      where: {
        productId: id,
        sale: {
          storeId,
          createdAt: { gte: startDate, lte: endDate },
        },
      },
      include: { sale: true },
    });

    const days = Math.max(
      1,
      Math.round(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
    );
    const totalUnitsSold = saleItems.reduce(
      (sum, item) => sum + Number(item.quantity),
      0,
    );
    const totalRevenue = saleItems.reduce(
      (sum, item) => sum + Number(item.subtotal),
      0,
    );
    const costPrice = Number(product.cost ?? 0);
    const totalCost = saleItems.reduce(
      (sum, item) => sum + Number(item.quantity) * costPrice,
      0,
    );
    const profit = totalRevenue - totalCost;
    const profitMargin =
      totalRevenue > 0 ? Math.round((profit / totalRevenue) * 10000) / 100 : 0;
    const transactionCount = new Set(saleItems.map((i) => i.saleId)).size;
    const avgDailySales = Math.round((totalUnitsSold / days) * 100) / 100;

    return {
      productId: id,
      period: {
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        days,
      },
      sales: {
        totalUnitsSold,
        totalRevenue,
        totalCost,
        profit,
        profitMargin,
        avgDailySales,
        transactionCount,
      },
      inventory: {
        currentStock: Number(product.stock),
        cost: costPrice,
        inventoryValue: Number(product.stock) * costPrice,
      },
    };
  }

  async syncBulk(
    storeId: string,
    products: Array<{
      barcode: string;
      nameUz: string;
      nameRu: string;
      price: number;
      cost?: number;
      stock?: number;
      minStock?: number;
      unit?: string;
      categoryId?: number;
      active?: boolean;
      productType?: string;
      internalCode?: string;
      bulkQuantity?: number;
      minSaleQty?: number;
      maxSaleQty?: number;
    }>,
  ) {
    let created = 0,
      skipped = 0,
      errors = 0;
    for (const p of products) {
      try {
        const existing = await this.prisma.product.findUnique({
          where: { storeId_barcode: { storeId, barcode: p.barcode } },
        });
        if (existing) {
          // VPS is the source of truth for product master data. A terminal must NEVER overwrite
          // an existing product's fields (active / price / name / category / …): a terminal re-
          // uploads a product whenever its local updatedAt advances, and that bumps on every sale
          // (stock decrement), so allowing updates here would silently revert web-admin edits
          // (e.g. deactivating a product). Terminals may only PULL existing products down (see
          // products-sync.ts) and CREATE brand-new offline products (the else branch below).
          // Stock itself flows only via sale sync (decrements) and inventory arrivals (increments).
          skipped++;
        } else {
          await this.prisma.product.create({
            data: {
              storeId,
              barcode: p.barcode,
              nameUz: p.nameUz,
              nameRu: p.nameRu,
              price: p.price,
              cost: p.cost ?? 0,
              stock: p.stock ?? 0,
              minStock: p.minStock ?? 0,
              unit: (p.unit as any) ?? "шт",
              categoryId: p.categoryId as any,
              active: p.active !== undefined ? p.active : true,
              productType: p.productType ?? 'REGULAR',
              internalCode: p.internalCode,
              bulkQuantity: p.bulkQuantity ?? 0,
              minSaleQty: p.minSaleQty ?? 0,
              maxSaleQty: p.maxSaleQty ?? 0,
              storeProductCode: await this.getNextStoreProductCode(storeId),
            },
          });
          created++;
        }
      } catch {
        errors++;
      }
    }
    return { created, skipped, errors };
  }
}
