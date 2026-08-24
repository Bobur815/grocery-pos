import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, InventoryCountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInventoryCountDto } from './dto/create-inventory-count.dto';
import {
  MovementSource,
  StockMovementService,
  type MovementInput,
} from '../stock-movement/stock-movement.service';

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

/** One product's resulting state, ready to be written by the completion SQL. */
export interface CompletionLine {
  itemId: string;
  productId: number;
  /** Quantity the product ends at — the counted figure, or 0 for a write-off. */
  countedQty: string;
  difference: string;
  writtenOff: boolean;
}

export interface CompletionPlan {
  rows: CompletionLine[];
  countedItems: number;
  writtenOffItems: number;
  totalDifference: Prisma.Decimal;
  totalValueDiff: Prisma.Decimal;
  /** Cost value of the write-off alone — a subset of totalValueDiff. */
  writeOffValue: Prisma.Decimal;
}

/** The subset of a count line the completion arithmetic actually reads. */
type PlannableItem = Pick<
  Prisma.InventoryCountItemGetPayload<object>,
  'id' | 'productId' | 'counted' | 'countedQty' | 'expectedQty' | 'cost'
>;

/**
 * Which uncounted lines to write off: `true` = every eligible one, `false` = none, or an
 * explicit set of item ids.
 *
 * The set exists because "uncounted" and "gone" are not the same thing. Stock can be
 * missing from the shelf at count time and still arrive later — goods in transit, a
 * delivery booked but not yet unpacked, an item held back for a customer. Zeroing those
 * loses real stock, so the operator picks the lines that are genuinely gone.
 */
export type WriteOffSelection = boolean | ReadonlySet<string>;

/**
 * Decide what completion will write, with no database involved — which is what makes it
 * testable. Counted lines and written-off lines produce the same shape, so downstream SQL
 * treats them identically.
 *
 * Uncounted lines are included only when `writeOff` selects them, and only when they
 * actually hold stock: writing 0 over 0 changes nothing but would still bump `updated_at`
 * on potentially thousands of rows and make every terminal re-pull them.
 *
 * Selection is an intersection, never a widening: an id that isn't an eligible uncounted
 * line of THIS document is ignored, so a stale or hand-crafted id list can't reach a line
 * the document doesn't own or overwrite one the cashier actually counted.
 */
export function planCompletion(
  items: PlannableItem[],
  writeOff: WriteOffSelection,
): CompletionPlan {
  let totalDifference = new Prisma.Decimal(0);
  let totalValueDiff = new Prisma.Decimal(0);
  let writeOffValue = new Prisma.Decimal(0);

  const buildRow = (
    item: PlannableItem,
    resultingQty: Prisma.Decimal,
    writtenOff: boolean,
  ): CompletionLine => {
    const difference = resultingQty.minus(item.expectedQty);
    totalDifference = totalDifference.plus(difference);
    if (item.cost) {
      const value = difference.times(item.cost);
      totalValueDiff = totalValueDiff.plus(value);
      if (writtenOff) writeOffValue = writeOffValue.plus(value);
    }
    return {
      itemId: item.id,
      productId: item.productId,
      countedQty: resultingQty.toString(),
      difference: difference.toString(),
      writtenOff,
    };
  };

  const counted = items.filter((i) => i.counted && i.countedQty !== null);
  const eligible = items.filter(
    (i) => !i.counted && new Prisma.Decimal(i.expectedQty).gt(0),
  );
  const toWriteOff =
    writeOff === false
      ? []
      : writeOff === true
        ? eligible
        : eligible.filter((i) => writeOff.has(i.id));

  const rows = [
    ...counted.map((item) => buildRow(item, new Prisma.Decimal(item.countedQty!), false)),
    ...toWriteOff.map((item) => buildRow(item, new Prisma.Decimal(0), true)),
  ];

  return {
    rows,
    countedItems: counted.length,
    writtenOffItems: toWriteOff.length,
    totalDifference,
    totalValueDiff,
    writeOffValue,
  };
}

@Injectable()
export class InventoryCountService {
  constructor(
    private prisma: PrismaService,
    private stockMovements: StockMovementService,
  ) {}

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
          wroteOffUncounted: true,
          writtenOffItems: true,
          writeOffValue: true,
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
   * By default uncounted lines are left completely untouched — never silently zeroed.
   * When `writeOff` selects them they are instead treated as "not physically present":
   * stock 0, `difference = -expectedQty`, flagged `writtenOff`. They travel the SAME code
   * path as counted lines, so the arithmetic, the watermark and immutability are identical.
   *
   * `writeOff` is either "all eligible" (`true`) or an explicit set of item ids — stock
   * that is merely missing today may still arrive tomorrow, so the operator chooses.
   */
  async complete(
    storeId: string,
    id: string,
    user: AuthUser,
    writeOff: WriteOffSelection = false,
  ) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!count || count.storeId !== storeId) throw new NotFoundException('Count not found');
    if (!OPEN_STATUSES.includes(count.status)) {
      throw new BadRequestException('Count cannot be completed');
    }

    const plan = planCompletion(count.items, writeOff);
    // Load-bearing guard: without it, "create a count, count nothing, tick write-off"
    // would zero the document's entire scope in one click.
    if (plan.countedItems === 0) throw new BadRequestException('Nothing counted yet');
    const rows = plan.rows;

    // Set-based updates: a per-row await loop blows Prisma's 5s transaction timeout on a
    // full-store count. The explicit timeout covers very large stores anyway.
    // ONE instant for the whole completion. Reconciliation measures a count exclusively at
    // its `completedAt`, so if the movements carried even a millisecond-earlier timestamp they
    // would fall inside that bound, the count would anchor on itself, and every variance would
    // collapse to zero. Two separate `new Date()` calls are all it takes.
    const completedAt = new Date();

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

          // counted_qty is written here too so a written-off line records the quantity it
          // ended at (0), keeping the invariant difference = counted_qty - expected_qty.
          // `counted` is deliberately NOT set for write-offs — written_off is what marks them.
          await tx.$executeRaw`
            UPDATE inventory_count_items i
            SET difference = v.diff, counted_qty = v.qty, written_off = v.written_off
            FROM (VALUES ${Prisma.join(
              chunk.map(
                (r) =>
                  Prisma.sql`(${r.itemId}::text, ${r.difference}::numeric, ${r.countedQty}::numeric, ${r.writtenOff}::boolean)`,
              ),
            )}) AS v(id, diff, qty, written_off)
            WHERE i.id = v.id
          `;
        }

        // Ledger rows for the whole document, written inside the same transaction as the
        // stock writes above. This is the ONLY place that produces an absolute anchor:
        // completion is the only absolute stock write in the system, so `balanceAfter` here
        // is what reconciliation recomputes forward from instead of summing from the
        // beginning of time (which would never match, because of the stock_counted_at
        // watermark suppressing pre-count sale decrements).
        //
        // Logging the delta AND setting the absolute is deliberate: absolute-set alone erases
        // the variance evidence, delta alone leaves the book wrong.
        if (this.stockMovements.enabled && rows.length > 0) {
          // Sale price is not on the count item (only cost is), so fetch it for the retail
          // valuation. One query for the document, not one per line.
          const priceById = new Map(
            (
              await tx.product.findMany({
                where: { id: { in: rows.map((r) => r.productId) } },
                select: { id: true, price: true },
              })
            ).map((pr) => [pr.id, pr.price]),
          );
          const costByItemId = new Map(count.items.map((i) => [i.id, i.cost]));


          await this.stockMovements.emit(
            tx,
            rows.map<MovementInput>((r) => ({
              storeId,
              productId: r.productId,
              type: r.writtenOff ? 'STOCKTAKE_WRITE_OFF' : 'STOCKTAKE_ADJUSTMENT',
              quantity: r.difference,
              balanceAfter: r.countedQty,
              unitCost: costByItemId.get(r.itemId) ?? null,
              unitPrice: priceById.get(r.productId) ?? null,
              sourceType: MovementSource.COUNT,
              sourceId: id,
              actorId: user.id,
              actorName: user.nameRu,
              occurredAt: completedAt,
            })),
          );
        }

        return tx.inventoryCount.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            completedAt,
            completedById: user.id,
            countedItems: plan.countedItems, // physically counted only — write-offs are separate
            totalDifference: plan.totalDifference,
            totalValueDiff: plan.totalValueDiff,
            wroteOffUncounted: plan.writtenOffItems > 0,
            writtenOffItems: plan.writtenOffItems,
            writeOffValue: plan.writeOffValue,
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
