import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateStoreDto } from "./dto/create-store.dto";
import { UpdateStoreDto } from "./dto/update-store.dto";
import * as bcrypt from "bcryptjs";
import { UserRole } from "@prisma/client";

@Injectable()
export class StoresService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.store.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            users: true,
            products: true,
            sales: true,
            terminalHeartbeats: true,
          },
        },
      },
    });
  }

  async findById(id: string) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            users: true,
            products: true,
            sales: true,
            terminalHeartbeats: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException("Store not found");
    }

    return store;
  }

  private async generateStoreId(): Promise<string> {
    const existing = await this.prisma.store.findMany({ select: { id: true } });
    const usedIds = new Set(existing.map((s) => s.id));

    let digits = 4;
    let min = 1000;
    let max = 9999;

    while (true) {
      for (let id = min; id <= max; id++) {
        const candidate = String(id);
        if (!usedIds.has(candidate)) return candidate;
      }
      // All N-digit IDs taken — expand to next digit length
      digits++;
      min = Math.pow(10, digits - 1);
      max = Math.pow(10, digits) - 1;
    }
  }

  async create(createStoreDto: CreateStoreDto) {
    const id = await this.generateStoreId();

    if (createStoreDto.phone) {
      const existingStore = await this.prisma.store.findFirst({
        where: { phone: createStoreDto.phone },
      });
      if (existingStore) {
        throw new ConflictException(
          "Store with this phone number already exists",
        );
      }

      const existingUser = await this.prisma.user.findFirst({
        where: { phone: createStoreDto.phone },
      });
      if (existingUser) {
        throw new ConflictException(
          "A user with this phone number already exists",
        );
      }
    }

    const hashedPassword = createStoreDto.phone
      ? await bcrypt.hash("123456", 10)
      : null;

    // Wrap both creates in a transaction so no orphaned store is left if user creation fails
    const store = await this.prisma.$transaction(async (tx) => {
      const s = await tx.store.create({
        data: {
          id,
          name: createStoreDto.name,
          address: createStoreDto.address,
          phone: createStoreDto.phone,
          settings: createStoreDto.settings
            ? JSON.stringify(createStoreDto.settings)
            : null,
          active: true,
        },
      });

      if (createStoreDto.phone && hashedPassword) {
        await tx.user.create({
          data: {
            storeId: s.id,
            phone: createStoreDto.phone,
            password: hashedPassword,
            role: UserRole.ADMIN,
            nameUz: "Administrator",
            nameRu: "Администратор",
            active: true,
          },
        });
      }

      return s;
    });

    return store;
  }

  async resetAdminUser(storeId: string, phone: string) {
    await this.findById(storeId);

    const existingUser = await this.prisma.user.findFirst({
      where: { phone },
    });
    if (existingUser && existingUser.storeId !== storeId) {
      throw new ConflictException(
        "A user with this phone already exists in another store",
      );
    }

    const hashedPassword = await bcrypt.hash("123456", 10);

    if (existingUser) {
      // Update the existing user to ADMIN and reset password
      return this.prisma.user.update({
        where: { id: existingUser.id },
        data: {
          role: UserRole.ADMIN,
          password: hashedPassword,
          storeId,
          active: true,
        },
        select: { id: true, phone: true, role: true, nameRu: true },
      });
    }

    return this.prisma.user.create({
      data: {
        storeId,
        phone,
        password: hashedPassword,
        role: UserRole.ADMIN,
        nameUz: "Administrator",
        nameRu: "Администратор",
        active: true,
      },
      select: { id: true, phone: true, role: true, nameRu: true },
    });
  }

  async update(id: string, updateStoreDto: UpdateStoreDto) {
    await this.findById(id);

    const data: Record<string, unknown> = {};

    if (updateStoreDto.name !== undefined) data.name = updateStoreDto.name;
    if (updateStoreDto.address !== undefined)
      data.address = updateStoreDto.address;
    if (updateStoreDto.phone !== undefined) data.phone = updateStoreDto.phone;
    if (updateStoreDto.active !== undefined)
      data.active = updateStoreDto.active;
    if (updateStoreDto.aiPlan !== undefined) data.aiPlan = updateStoreDto.aiPlan;
    if (updateStoreDto.subscriptionPlan !== undefined) data.subscriptionPlan = updateStoreDto.subscriptionPlan;
    if (updateStoreDto.subscriptionExpiresAt !== undefined) {
      data.subscriptionExpiresAt = updateStoreDto.subscriptionExpiresAt
        ? new Date(updateStoreDto.subscriptionExpiresAt)
        : null;
    }
    if (updateStoreDto.settings !== undefined) {
      data.settings = JSON.stringify(updateStoreDto.settings);
    }

    return this.prisma.store.update({
      where: { id },
      data,
    });
  }

  async activate(id: string) {
    await this.findById(id);

    await this.prisma.store.update({
      where: { id },
      data: { active: true },
    });

    return { success: true };
  }

  async delete(id: string) {
    await this.findById(id);

    const scheduledDeleteAt = new Date();
    scheduledDeleteAt.setDate(scheduledDeleteAt.getDate() + 30);

    await this.prisma.store.update({
      where: { id },
      data: { active: false, scheduledDeleteAt },
    });

    return { success: true, scheduledDeleteAt };
  }

  async cancelDelete(id: string) {
    await this.findById(id);

    await this.prisma.store.update({
      where: { id },
      data: { active: true, scheduledDeleteAt: null },
    });

    return { success: true };
  }

  async purgeExpired() {
    const expired = await this.prisma.store.findMany({
      where: { scheduledDeleteAt: { lte: new Date() } },
      select: { id: true },
    });

    for (const { id } of expired) {
      await this.prisma.$transaction([
        this.prisma.terminalHeartbeat.deleteMany({ where: { storeId: id } }),
        this.prisma.systemSetting.deleteMany({ where: { storeId: id } }),
        this.prisma.supplierTransaction.deleteMany({ where: { storeId: id } }),
        this.prisma.inventoryArrival.deleteMany({ where: { storeId: id } }),
        this.prisma.sale.deleteMany({ where: { storeId: id } }),
        // UserSessions cascade-delete with User (onDelete: Cascade on userId)
        this.prisma.product.deleteMany({ where: { storeId: id } }),
        this.prisma.supplier.deleteMany({ where: { storeId: id } }),
        this.prisma.category.deleteMany({ where: { storeId: id } }),
        this.prisma.user.deleteMany({ where: { storeId: id } }),
        this.prisma.store.delete({ where: { id } }),
      ]);
    }

    return { purged: expired.length };
  }

  async deactivate(id: string) {
    await this.findById(id);

    await this.prisma.store.update({
      where: { id },
      data: { active: false },
    });

    return { success: true };
  }

  async addCredits(id: string, amount: number) {
    await this.findById(id);

    const updated = await this.prisma.store.update({
      where: { id },
      data: { balance: { increment: amount } },
      select: { id: true, balance: true },
    });

    return { success: true, balance: Number(updated.balance) };
  }

  async getStats(id: string) {
    const store = await this.findById(id);

    // Get total revenue for this store
    const salesAgg = await this.prisma.sale.aggregate({
      where: { storeId: id },
      _sum: { finalAmount: true },
      _count: true,
    });

    const productsCount = await this.prisma.product.count({
      where: { storeId: id, active: true },
    });

    const usersCount = await this.prisma.user.count({
      where: { storeId: id, active: true },
    });

    return {
      store,
      stats: {
        totalRevenue: salesAgg._sum.finalAmount || 0,
        totalSales: salesAgg._count,
        productsCount,
        usersCount,
      },
    };
  }
}
