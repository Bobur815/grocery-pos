import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MovementSource,
  StockMovementService,
} from '../stock-movement/stock-movement.service';
import { ProductsService } from '../products/products.service';
import { CreateArrivalDto } from './dto/create-arrival.dto';
import { UpdateArrivalDto } from './dto/update-arrival.dto';
import { Product, SupplierPaymentMethod, SupplierTransactionType } from '@prisma/client';
import { ArrivalFilters, InventoryArrivalWhereInput } from './types/inventory.types';

const DEBT_PAYMENT_METHODS: SupplierPaymentMethod[] = [
  SupplierPaymentMethod.INSTALLMENT,
  SupplierPaymentMethod.ONE_TO_ONE,
];

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private productsService: ProductsService,
    private stockMovements: StockMovementService,
  ) {}

  async getArrivals(storeId: string, filters?: ArrivalFilters) {
    const where: InventoryArrivalWhereInput = { storeId };

    if (filters?.productId) where.productId = filters.productId;
    if (filters?.startDate) where.createdAt = { gte: filters.startDate };

    return this.prisma.inventoryArrival.findMany({
      where,
      include: {
        product: true,
        supplier: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createArrival(storeId: string, createArrivalDto: CreateArrivalDto, userId: string, lang?: string) {
    // Validate product exists and belongs to store
    const product = await this.prisma.product.findUnique({
      where: { id: createArrivalDto.productId },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException(`Product with ID ${createArrivalDto.productId} not found`);
    }

    // Validate supplier exists and belongs to store if provided
    if (createArrivalDto.supplierId) {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: createArrivalDto.supplierId },
      });
      if (!supplier || supplier.storeId !== storeId) {
        throw new NotFoundException(`Supplier with ID ${createArrivalDto.supplierId} not found`);
      }
    }

    const cost = createArrivalDto.cost ?? 0;
    const totalCost = createArrivalDto.quantity * cost;

    // Create arrival record
    const arrival = await this.prisma.inventoryArrival.create({
      data: {
        storeId,
        productId: createArrivalDto.productId,
        quantity: createArrivalDto.quantity,
        cost,
        totalCost,
        supplierId: createArrivalDto.supplierId || null,
        notes: createArrivalDto.notes || null,
        createdBy: userId,
      },
      include: {
        product: true,
        supplier: true,
      },
    });

    // Build product update: always update stock; only update cost if provided
    const productUpdate: Record<string, unknown> = {
      stock: { increment: createArrivalDto.quantity },
      ...(createArrivalDto.cost != null && { cost: createArrivalDto.cost }),
    };

    if (createArrivalDto.productionDate) {
      productUpdate.productionDate = new Date(createArrivalDto.productionDate);
    }
    if (createArrivalDto.expiryDate) {
      productUpdate.expiryDate = new Date(createArrivalDto.expiryDate);
    }

    if (createArrivalDto.priceMode === 'immediate' && createArrivalDto.newPrice != null) {
      productUpdate.price = createArrivalDto.newPrice;
      // Clear any pending price since we're applying immediately
      productUpdate.pendingPrice = null;
      productUpdate.pendingPriceThreshold = null;
    } else if (createArrivalDto.priceMode === 'deferred' && createArrivalDto.newPrice != null) {
      // Price will apply after current stock sells down
      productUpdate.pendingPrice = createArrivalDto.newPrice;
      productUpdate.pendingPriceThreshold = product.stock;
    }

    await this.prisma.product.update({
      where: { id: createArrivalDto.productId },
      data: productUpdate,
    });

    // Snapshot the cost this delivery actually came in at, and the price it will be sold at
    // after any priceMode change above — that ordering matters, because valuing a variance
    // at a stale price is exactly the re-pricing trap the ledger exists to avoid.
    await this.stockMovements.emitStandalone([
      {
        storeId,
        productId: createArrivalDto.productId,
        type: 'ARRIVAL',
        quantity: createArrivalDto.quantity, // signed: a delivery adds stock
        unitCost: cost,
        unitPrice: (productUpdate.price as number | undefined) ?? product.price,
        sourceType: MovementSource.ARRIVAL,
        sourceId: arrival.id,
        note: createArrivalDto.notes || null,
        actorId: userId,
        occurredAt: arrival.createdAt,
      },
    ]);

    if (createArrivalDto.supplierId && createArrivalDto.paymentMethod) {
      const paymentMethod = createArrivalDto.paymentMethod as SupplierPaymentMethod;
      const isDebt = DEBT_PAYMENT_METHODS.includes(paymentMethod);
      const isUz = lang?.startsWith('uz');
      const arrivalWord = isUz ? 'Kirim' : 'Приход';
      const productName = isUz ? product.nameUz : product.nameRu;
      const descriptionPayload = {
        arrivalWord,
        productId: product.id,
        productName,
        quantity: createArrivalDto.quantity,
        cost,
      };

      await this.prisma.supplierTransaction.create({
        data: {
          storeId,
          supplierId: createArrivalDto.supplierId,
          type: SupplierTransactionType.PURCHASE,
          paymentMethod,
          amount: -totalCost,
          description: descriptionPayload,
          referenceId: arrival.id,
          referenceType: 'ARRIVAL',
          createdBy: userId,
        },
      });

      if (isDebt) {
        // Debt methods: supplier balance decrements (we owe more)
        await this.prisma.supplier.update({
          where: { id: createArrivalDto.supplierId },
          data: { balance: { decrement: totalCost } },
        });
      } else {
        // Immediate payment (CASH/BANK_TRANSFER): record payment transaction so
        // both sides of the exchange appear in transaction history; balance stays 0.
        await this.prisma.supplierTransaction.create({
          data: {
            storeId,
            supplierId: createArrivalDto.supplierId,
            type: SupplierTransactionType.PAYMENT,
            paymentMethod,
            amount: totalCost,
            description: descriptionPayload,
            referenceId: arrival.id,
            referenceType: 'ARRIVAL',
            createdBy: userId,
            paidAt: new Date(),
          },
        });
      }
    }

    return arrival;
  }

  async updateArrival(id: string, storeId: string, dto: UpdateArrivalDto) {
    const arrival = await this.prisma.inventoryArrival.findUnique({ where: { id } });
    if (!arrival || arrival.storeId !== storeId) throw new NotFoundException('Arrival not found');

    const oldQty = Number(arrival.quantity);
    const oldCost = Number(arrival.cost);
    const newQty = dto.quantity ?? oldQty;
    const newCost = dto.cost ?? oldCost;
    const oldTotal = oldQty * oldCost;
    const newTotal = newQty * newCost;
    const qtyDelta = newQty - oldQty;

    return this.prisma.$transaction(async (tx) => {
      await tx.inventoryArrival.update({
        where: { id },
        data: {
          quantity: newQty,
          cost: newCost,
          totalCost: newTotal,
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
      });

      // Adjust product stock by delta
      if (qtyDelta !== 0) {
        await tx.product.update({
          where: { id: arrival.productId },
          data: { stock: { increment: qtyDelta } },
        });

        // Inside the caller's transaction. Typed ARRIVAL_ADJUSTMENT rather than ARRIVAL so a
        // correction to a delivery never inflates "goods received" in the period report.
        await this.stockMovements.emit(tx, [
          {
            storeId,
            productId: arrival.productId,
            type: 'ARRIVAL_ADJUSTMENT',
            quantity: qtyDelta, // already signed
            unitCost: newCost,
            sourceType: MovementSource.ARRIVAL,
            sourceId: id,
            note: 'Arrival quantity corrected',
            occurredAt: new Date(),
          },
        ]);
      }

      // Update the linked PURCHASE supplier transaction if it exists
      const purchaseTx = await tx.supplierTransaction.findFirst({
        where: { referenceId: id, referenceType: 'ARRIVAL', type: SupplierTransactionType.PURCHASE },
      });

      if (purchaseTx && arrival.supplierId) {
        const amountDelta = -(newTotal - oldTotal); // PURCHASE amounts are negative
        await tx.supplierTransaction.update({
          where: { id: purchaseTx.id },
          data: { amount: -newTotal },
        });
        // Only update balance for debt payment methods (INSTALLMENT / ONE_TO_ONE)
        if (
          purchaseTx.paymentMethod === SupplierPaymentMethod.INSTALLMENT ||
          purchaseTx.paymentMethod === SupplierPaymentMethod.ONE_TO_ONE
        ) {
          await tx.supplier.update({
            where: { id: arrival.supplierId },
            data: { balance: { increment: amountDelta } },
          });
        }
      }

      return tx.inventoryArrival.findUnique({
        where: { id },
        include: { product: { select: { id: true, nameRu: true, nameUz: true } } },
      });
    });
  }

  async syncBulkArrivals(storeId: string, arrivals: Array<{
    id: string;
    productBarcode: string;
    supplierId?: string;
    quantity: number;
    cost: number;
    notes?: string;
    createdBy: string;
    createdAt: string;
  }>) {
    let created = 0, skipped = 0, errors = 0;
    for (const a of arrivals) {
      try {
        // Skip if already synced (idempotent by local id)
        const existing = await this.prisma.inventoryArrival.findUnique({ where: { id: a.id } });
        if (existing) { skipped++; continue; }

        // Look up product by barcode
        const product = await this.prisma.product.findUnique({
          where: { storeId_barcode: { storeId, barcode: a.productBarcode } },
        });
        if (!product) { errors++; continue; }

        const totalCost = a.quantity * a.cost;
        // Wrap both writes in a transaction: if the stock increment fails the
        // arrival record is rolled back too, so the next sync cycle can retry it.
        // Without this, a partial failure would permanently skip the stock increment
        // (the idempotency check would see the arrival as already processed).
        await this.prisma.$transaction(async (tx) => {
          await tx.inventoryArrival.create({
            data: {
              id: a.id,
              storeId,
              productId: product.id,
              supplierId: a.supplierId || null,
              quantity: a.quantity,
              cost: a.cost,
              totalCost,
              notes: a.notes || null,
              createdBy: a.createdBy,
              createdAt: new Date(a.createdAt),
            },
          });
          // Update stock on server too
          await tx.product.update({
            where: { id: product.id },
            data: { stock: { increment: a.quantity }, cost: a.cost },
          });

          await this.stockMovements.emit(tx, [
            {
              storeId,
              productId: product.id,
              type: 'ARRIVAL',
              quantity: a.quantity,
              unitCost: a.cost,
              unitPrice: product.price,
              sourceType: MovementSource.ARRIVAL,
              // Terminal-supplied arrival id (the same one written above), which makes the
              // dedup key stable across sync retries of the same backlog.
              sourceId: a.id,
              note: a.notes || null,
              actorId: a.createdBy,
              // The uploaded arrival carries its own timestamp — an offline terminal may be
              // replaying a backlog, and the period report must bucket by when it happened.
              occurredAt: new Date(a.createdAt),
            },
          ]);
        });
        created++;
      } catch {
        errors++;
      }
    }
    return { created, skipped, errors };
  }

  async getLowStock(storeId: string) {
    // Get products where stock is at or below minStock
    const products = await this.prisma.product.findMany({
      where: {
        storeId,
        active: true,
      },
      include: { category: true },
      orderBy: { stock: 'asc' },
    });

    // Filter in memory since Prisma doesn't support comparing two columns directly
    return products.filter((p: Product) => Number(p.stock) <= Number(p.minStock));
  }
}
