import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MovementSource,
  StockMovementService,
} from '../stock-movement/stock-movement.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { SupplierFilters, SupplierWhereInput } from './types/supplier.types';
import { Prisma, SupplierTransactionType, SupplierPaymentMethod, SupplierPaymentType } from '@prisma/client';

@Injectable()
export class SuppliersService {
  constructor(
    private prisma: PrismaService,
    private stockMovements: StockMovementService,
  ) {}

  async findByPhoneAnyStore(phone: string) {
    return this.prisma.supplier.findFirst({
      where: { phone, active: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAll(storeId: string, filters?: SupplierFilters) {
    const where: SupplierWhereInput = { storeId };

    if (filters?.active !== undefined) {
      where.active = filters.active;
    }

    if (filters?.search) {
      where.OR = [
        { nameRu: { contains: filters.search, mode: 'insensitive' } },
        { nameUz: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search } },
      ];
    }

    return this.prisma.supplier.findMany({
      where,
      include: { categories: true },
      orderBy: { nameRu: 'asc' },
    });
  }

  async findById(id: string, storeId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        categories: true,
        arrivals: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: { product: true },
        },
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        products: {
          where: { active: true },
          orderBy: { nameRu: 'asc' },
        },
      },
    });

    if (!supplier || supplier.storeId !== storeId) {
      throw new NotFoundException('Supplier not found');
    }

    return supplier;
  }

  async create(storeId: string, createSupplierDto: CreateSupplierDto) {
    const { categoryIds, paymentType, ...data } = createSupplierDto;

    return this.prisma.supplier.create({
      data: {
        storeId,
        nameUz: data.nameUz,
        nameRu: data.nameRu,
        phone: data.phone || null,
        address: data.address || null,
        balance: data.balance ?? 0,
        active: true,
        paymentType: paymentType as SupplierPaymentType,
        categories: categoryIds?.length
          ? { connect: categoryIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { categories: true },
    });
  }

  async update(id: string, storeId: string, updateSupplierDto: UpdateSupplierDto) {
    await this.findById(id, storeId);

    const { categoryIds, paymentType, ...data } = updateSupplierDto;

    return this.prisma.supplier.update({
      where: { id },
      data: {
        ...data,
        ...(paymentType && { paymentType: paymentType as SupplierPaymentType }),
        categories: categoryIds
          ? { set: categoryIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { categories: true },
    });
  }

  async deactivate(id: string, storeId: string) {
    await this.findById(id, storeId);

    await this.prisma.supplier.update({
      where: { id },
      data: { active: false },
    });

    return { success: true };
  }

  async syncBulk(storeId: string, suppliers: Array<{
    id: string;
    nameUz: string;
    nameRu: string;
    phone?: string;
    address?: string;
    active?: boolean;
  }>) {
    let created = 0, updated = 0, errors = 0;
    for (const s of suppliers) {
      try {
        await this.prisma.supplier.upsert({
          where: { id: s.id },
          update: {
            nameUz: s.nameUz,
            nameRu: s.nameRu,
            phone: s.phone || null,
            address: s.address || null,
            ...(s.active !== undefined && { active: s.active }),
          },
          create: {
            id: s.id,
            storeId,
            nameUz: s.nameUz,
            nameRu: s.nameRu,
            phone: s.phone || null,
            address: s.address || null,
            active: s.active !== undefined ? s.active : true,
          },
        });
        created++;
      } catch {
        errors++;
      }
    }
    return { created, updated, errors };
  }

  async getTransactions(storeId: string, filters?: { supplierId?: string; type?: string }) {
    return this.prisma.supplierTransaction.findMany({
      where: {
        storeId,
        ...(filters?.supplierId && { supplierId: filters.supplierId }),
        ...(filters?.type && { type: filters.type as SupplierTransactionType }),
      },
      include: { supplier: { select: { id: true, nameRu: true, nameUz: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createTransaction(storeId: string, userId: string, dto: CreateTransactionDto) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.supplierTransaction.create({
        data: {
          storeId,
          supplierId: dto.supplierId,
          type: dto.type as SupplierTransactionType,
          paymentMethod: dto.paymentMethod as SupplierPaymentMethod,
          amount: dto.amount,
          description: dto.description ? { text: dto.description } : Prisma.JsonNull,
          referenceId: dto.referenceId ?? null,
          referenceType: dto.referenceType ?? null,
          dueDate: null,
          paidAt: null,
          createdBy: userId,
        },
      });

      const balanceDelta = this.balanceDeltaFor(dto.type as SupplierTransactionType, dto.amount);
      await tx.supplier.update({
        where: { id: dto.supplierId },
        data: { balance: { increment: balanceDelta } },
      });

      // Subtract stock when returning product to supplier
      if (
        dto.type === 'RETURN' &&
        dto.referenceType === 'PRODUCT' &&
        dto.referenceId &&
        dto.quantity != null
      ) {
        const productId = parseInt(dto.referenceId, 10);
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { cost: true, price: true },
        });
        await tx.product.update({
          where: { id: productId },
          data: { stock: { decrement: dto.quantity } },
        });

        // Inside the caller's transaction, so the ledger row and the stock write it describes
        // commit or roll back together.
        await this.stockMovements.emit(tx, [
          {
            storeId,
            productId,
            type: 'SUPPLIER_RETURN',
            quantity: -dto.quantity, // signed: goods going back to the supplier leave stock
            unitCost: product?.cost ?? null,
            unitPrice: product?.price ?? null,
            sourceType: MovementSource.SUPPLIER_TX,
            sourceId: created.id,
            note: dto.description ?? null,
            occurredAt: new Date(),
          },
        ]);
      }

      return created;
    });
  }

  async updateTransaction(txId: string, storeId: string, dto: UpdateTransactionDto) {
    const existing = await this.prisma.supplierTransaction.findUnique({ where: { id: txId } });
    if (!existing || existing.storeId !== storeId) throw new NotFoundException('Transaction not found');

    return this.prisma.$transaction(async (tx) => {
      const oldDelta = this.balanceDeltaFor(existing.type, Number(existing.amount));
      const newType = (dto.type ?? existing.type) as SupplierTransactionType;
      const newAmount = dto.amount !== undefined ? dto.amount : Number(existing.amount);
      const newDelta = this.balanceDeltaFor(newType, newAmount);

      await tx.supplier.update({
        where: { id: existing.supplierId },
        data: { balance: { increment: newDelta - oldDelta } },
      });

      const updateData: Record<string, unknown> = {};
      if (dto.type) updateData.type = dto.type;
      if (dto.paymentMethod) updateData.paymentMethod = dto.paymentMethod;
      if (dto.amount !== undefined) updateData.amount = dto.amount;
      if (dto.description !== undefined) updateData.description = dto.description ? { text: dto.description } : null;

      return tx.supplierTransaction.update({ where: { id: txId }, data: updateData });
    });
  }

  async deleteTransaction(txId: string, storeId: string) {
    const existing = await this.prisma.supplierTransaction.findUnique({ where: { id: txId } });
    if (!existing || existing.storeId !== storeId) throw new NotFoundException('Transaction not found');

    await this.prisma.$transaction(async (tx) => {
      const delta = this.balanceDeltaFor(existing.type, Number(existing.amount));
      await tx.supplier.update({
        where: { id: existing.supplierId },
        data: { balance: { increment: -delta } },
      });
      await tx.supplierTransaction.delete({ where: { id: txId } });
    });

    return { success: true };
  }

  async getBalance(supplierId: string, storeId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, storeId: true, balance: true, nameRu: true, nameUz: true },
    });
    if (!supplier || supplier.storeId !== storeId) throw new NotFoundException('Supplier not found');
    return { supplierId, balance: supplier.balance };
  }

  async recordPayment(storeId: string, userId: string, dto: Omit<CreateTransactionDto, 'type'>) {
    return this.createTransaction(storeId, userId, { ...dto, type: 'PAYMENT' });
  }

  private balanceDeltaFor(type: SupplierTransactionType, amount: number): number {
    // Negative balance = we owe them; positive = they owe us (matches POS app convention)
    switch (type) {
      case 'PURCHASE':   return -amount;  // we received goods → we owe more (more negative)
      case 'PAYMENT':    return amount;   // we paid → debt decreases (less negative)
      case 'RETURN':     return amount;   // we returned goods → debt decreases
      case 'ADVANCE':    return amount;   // we pre-paid → they owe us (positive)
      case 'ADJUSTMENT': return amount;   // manual, positive or negative
      default:           return 0;
    }
  }

  async delete(id: string, storeId: string) {
    await this.findById(id, storeId);

    // Check if supplier has arrivals
    const arrivalsCount = await this.prisma.inventoryArrival.count({
      where: { supplierId: id },
    });

    if (arrivalsCount > 0) {
      // Soft delete if has arrivals
      return this.deactivate(id, storeId);
    }

    // Hard delete if no arrivals
    await this.prisma.supplier.delete({
      where: { id },
    });

    return { success: true, deleted: true };
  }
}
