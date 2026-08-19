import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, InventoryCountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';

/** Subset of the authenticated user this module needs. `request.user` has no `name` — only nameRu/nameUz. */
type AuthUser = { id: string; nameRu: string };

export interface ListInventoryCountFilters {
  search?: string;
  status?: InventoryCountStatus;
  page?: number;
  limit?: number;
}

const OPEN_STATUSES: InventoryCountStatus[] = ['DRAFT', 'IN_PROGRESS'];

/** Rows per set-based UPDATE on completion — keeps the bound-parameter count sane. */
const COMPLETE_CHUNK_SIZE = 500;

@Injectable()
export class InventoryCountService {
  constructor(private prisma: PrismaService) {}

  /**
   * Open a new count document. Every line snapshots the product's CURRENT stock as
   * `expectedQty` — reconciliation is always against what the system believed at count
   * time, never against live stock that keeps moving while someone walks the aisles.
   */
  async create(storeId: string, dto: CreateInventoryCountDto, user: AuthUser) {
    const scope = dto.scope ?? 'FULL';

    if (scope === 'CUSTOM') {
      throw new BadRequestException('CUSTOM scope is not supported yet');
    }

    // Two open documents would fight over the same stock on completion.
    const open = await this.prisma.inventoryCount.findFirst({
      where: { storeId, status: { in: OPEN_STATUSES } },
      select: { id: true, number: true },
    });
    if (open) {
      throw new BadRequestException(
        `An open stocktake (#${open.number}) already exists — finish or cancel it first`,
      );
    }

    const where: Prisma.ProductWhereInput = { storeId, active: true };
    if (scope === 'CATEGORY') {
      if (!dto.categoryId) {
        throw new BadRequestException('categoryId is required for CATEGORY scope');
      }
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, storeId },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('Category not found');
      where.categoryId = dto.categoryId;
    }

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        nameRu: true,
        nameUz: true,
        barcode: true,
        unit: true,
        stock: true,
        cost: true,
      },
      orderBy: { nameRu: 'asc' },
    });
    if (products.length === 0) throw new BadRequestException('No products in scope');

    const number = await this.getNextCountNumber(storeId);

    return this.prisma.inventoryCount.create({
      data: {
        storeId,
        number,
        status: 'DRAFT',
        scope,
        categoryId: scope === 'CATEGORY' ? dto.categoryId : null,
        note: dto.note,
        createdById: user.id,
        createdByName: user.nameRu,
        totalItems: products.length,
        items: {
          create: products.map((p) => ({
            productId: p.id,
            productName: p.nameRu,
            productNameUz: p.nameUz,
            barcode: p.barcode,
            unit: p.unit,
            expectedQty: p.stock, // <-- the snapshot
            cost: p.cost,
          })),
        },
      },
      select: { id: true, number: true, status: true, scope: true, totalItems: true },
    });
  }

  async findAll(storeId: string, filters: ListInventoryCountFilters = {}) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

    const where: Prisma.InventoryCountWhereInput = { storeId };
    if (filters.status) where.status = filters.status;
    if (filters.search?.trim()) {
      const search = filters.search.trim();
      const asNumber = Number(search);
      where.OR = [
        { note: { contains: search, mode: 'insensitive' } },
        { createdByName: { contains: search, mode: 'insensitive' } },
        ...(Number.isInteger(asNumber) ? [{ number: asNumber }] : []),
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryCount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          number: true,
          status: true,
          scope: true,
          note: true,
          createdByName: true,
          createdAt: true,
          completedAt: true,
          totalItems: true,
          countedItems: true,
          totalDifference: true,
          totalValueDiff: true,
        },
      }),
      this.prisma.inventoryCount.count({ where }),
    ]);

    return { rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
  }

  async findOne(storeId: string, id: string) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: { items: { orderBy: { productName: 'asc' } } },
    });
    if (!count || count.storeId !== storeId) throw new NotFoundException('Count not found');
    return count;
  }

  /** Enter/adjust the physical count for one line. */
  async setItemCount(storeId: string, id: string, itemId: string, countedQty: number) {
    const count = await this.loadOpenCount(storeId, id);

    const existing = await this.prisma.inventoryCountItem.findUnique({
      where: { id: itemId },
      select: { countId: true },
    });
    if (!existing || existing.countId !== id) {
      throw new NotFoundException('Count line not found');
    }

    const item = await this.prisma.inventoryCountItem.update({
      where: { id: itemId },
      data: { countedQty, counted: true },
    });

    return this.refreshProgress(id, count.status, count.totalItems, item);
  }

  /** Scan flow: barcode -> add `qty` to that line. */
  async scan(storeId: string, id: string, barcode: string, qty = 1) {
    const count = await this.loadOpenCount(storeId, id);

    const item = await this.prisma.inventoryCountItem.findFirst({
      where: { countId: id, barcode },
    });
    if (!item) throw new NotFoundException('Product not in this count');

    const next = (item.countedQty ? Number(item.countedQty) : 0) + qty;
    const updated = await this.prisma.inventoryCountItem.update({
      where: { id: item.id },
      data: { countedQty: Math.max(0, next), counted: true },
    });

    return this.refreshProgress(id, count.status, count.totalItems, updated);
  }

  /**
   * Finalize: apply stock, compute the summary, lock the document.
   *
   * This is the only ABSOLUTE stock write in the system — physical reality wins. Every
   * other server-side mutation is a delta (arrivals increment, sales decrement), so the
   * write also stamps `stock_counted_at`, which sale-sync uses to avoid decrementing a
   * second time for sales that already happened before the count (see SalesService).
   *
   * Uncounted lines are left completely untouched — never silently zeroed.
   */
  async complete(storeId: string, id: string, user: AuthUser) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!count || count.storeId !== storeId) throw new NotFoundException('Count not found');
    if (!OPEN_STATUSES.includes(count.status)) {
      throw new BadRequestException('Count cannot be completed');
    }

    const counted = count.items.filter((i) => i.counted && i.countedQty !== null);
    if (counted.length === 0) throw new BadRequestException('Nothing counted yet');

    let totalDifference = new Prisma.Decimal(0);
    let totalValueDiff = new Prisma.Decimal(0);
    const rows = counted.map((item) => {
      const difference = new Prisma.Decimal(item.countedQty!).minus(item.expectedQty);
      totalDifference = totalDifference.plus(difference);
      if (item.cost) totalValueDiff = totalValueDiff.plus(difference.times(item.cost));
      return {
        itemId: item.id,
        productId: item.productId,
        countedQty: new Prisma.Decimal(item.countedQty!).toString(),
        difference: difference.toString(),
      };
    });

    // Set-based updates: a per-row await loop blows Prisma's 5s transaction timeout on a
    // full-store count. The explicit timeout covers very large stores anyway.
    return this.prisma.$transaction(
      async (tx) => {
        for (const chunk of chunked(rows, COMPLETE_CHUNK_SIZE)) {
          // `updated_at = NOW()` is mandatory: raw SQL bypasses Prisma's @updatedAt, and
          // terminals pull product changes via an `updatedAfter` cursor. Without it the
          // count would never reach the POS terminals.
          await tx.$executeRaw`
            UPDATE products p
            SET stock = v.counted, stock_counted_at = NOW(), updated_at = NOW()
            FROM (VALUES ${Prisma.join(
              chunk.map((r) => Prisma.sql`(${r.productId}::int, ${r.countedQty}::numeric)`),
            )}) AS v(product_id, counted)
            WHERE p.id = v.product_id AND p.store_id = ${storeId}
          `;

          await tx.$executeRaw`
            UPDATE inventory_count_items i
            SET difference = v.diff
            FROM (VALUES ${Prisma.join(
              chunk.map((r) => Prisma.sql`(${r.itemId}::text, ${r.difference}::numeric)`),
            )}) AS v(id, diff)
            WHERE i.id = v.id
          `;
        }

        return tx.inventoryCount.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            completedById: user.id,
            countedItems: counted.length,
            totalDifference,
            totalValueDiff,
          },
        });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  async cancel(storeId: string, id: string) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      select: { id: true, storeId: true, status: true },
    });
    if (!count || count.storeId !== storeId) throw new NotFoundException('Count not found');
    if (count.status === 'COMPLETED') {
      throw new BadRequestException('Cannot cancel a completed count');
    }
    return this.prisma.inventoryCount.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /** Next per-store document number — same aggregate pattern as `storeProductCode`. */
  private async getNextCountNumber(storeId: string): Promise<number> {
    const agg = await this.prisma.inventoryCount.aggregate({
      where: { storeId },
      _max: { number: true },
    });
    return (agg._max.number ?? 0) + 1;
  }

  /** Load a count that belongs to this store and is still editable. */
  private async loadOpenCount(storeId: string, id: string) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      select: { id: true, storeId: true, status: true, totalItems: true },
    });
    if (!count || count.storeId !== storeId) throw new NotFoundException('Count not found');
    if (!OPEN_STATUSES.includes(count.status)) {
      throw new BadRequestException('Count is closed');
    }
    return count;
  }

  /**
   * Persist progress and return only the touched line — returning the whole document
   * would re-send thousands of rows on every keystroke of the counting screen.
   */
  private async refreshProgress(
    id: string,
    currentStatus: InventoryCountStatus,
    totalItems: number,
    item: Prisma.InventoryCountItemGetPayload<object>,
  ) {
    const countedItems = await this.prisma.inventoryCountItem.count({
      where: { countId: id, counted: true },
    });
    const status: InventoryCountStatus =
      currentStatus === 'DRAFT' ? 'IN_PROGRESS' : currentStatus;

    await this.prisma.inventoryCount.update({
      where: { id },
      data: { status, countedItems },
    });

    return { item, countedItems, totalItems, status };
  }
}

function chunked<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
