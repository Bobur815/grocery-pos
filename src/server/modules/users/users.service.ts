import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';
import { USER_ROLES } from '@shared/constants';
import { UserRole } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(storeId: string) {
    return this.prisma.user.findMany({
      where: { storeId },
      select: {
        id: true,
        storeId: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllStores() {
    // For SUPER_ADMIN: get users across all stores
    return this.prisma.user.findMany({
      select: {
        id: true,
        storeId: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
        store: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        storeId: true,
        phone: true,
        password: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
        // Joined rather than fetched separately: `validateUser` runs on every authenticated
        // request and needs the store's state to keep a deactivated shop out. Pulling it in here
        // costs no extra round trip.
        store: { select: { active: true, mode: true } },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findAllForSync(storeId: string) {
    return this.prisma.user.findMany({
      where: { storeId },
      select: {
        id: true,
        phone: true,
        password: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByPhoneAnyStore(phone: string) {
    return this.prisma.user.findFirst({
      where: { phone, active: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByPhoneAndStore(phone: string, storeId?: string) {
    // First try to find SUPER_ADMIN (has no storeId)
    const superAdmin = await this.prisma.user.findFirst({
      where: {
        phone,
        role: UserRole.SUPER_ADMIN,
        storeId: null,
      },
    });

    if (superAdmin) {
      return superAdmin;
    }

    // If storeId is provided, find user within that store
    if (storeId) {
      return this.prisma.user.findUnique({
        where: {
          storeId_phone: { storeId, phone },
        },
      });
    }

    return null;
  }

  async create(createUserDto: CreateUserDto, storeId: string) {
    // Check if user already exists in this store
    const existing = await this.prisma.user.findUnique({
      where: {
        storeId_phone: { storeId, phone: createUserDto.phone },
      },
    });

    if (existing) {
      throw new ConflictException('Phone number already exists in this store');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        storeId,
        phone: createUserDto.phone,
        password: hashedPassword,
        role: createUserDto.role || USER_ROLES.USER,
        nameUz: createUserDto.nameUz,
        nameRu: createUserDto.nameRu,
        active: true,
      },
      select: {
        id: true,
        storeId: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
      },
    });

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, storeId: string) {
    const user = await this.findById(id);

    // Ensure user belongs to the store
    if (user.storeId !== storeId) {
      throw new NotFoundException('User not found');
    }

    const data: Record<string, unknown> = {};

    if (updateUserDto.nameUz) data.nameUz = updateUserDto.nameUz;
    if (updateUserDto.nameRu) data.nameRu = updateUserDto.nameRu;
    if (updateUserDto.role) data.role = updateUserDto.role;
    if (updateUserDto.active !== undefined) data.active = updateUserDto.active;

    if (updateUserDto.password) {
      data.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        storeId: true,
        phone: true,
        role: true,
        nameUz: true,
        nameRu: true,
        active: true,
        createdAt: true,
      },
    });
  }

  async activate(id: string, storeId: string) {
    const user = await this.findById(id);
    if (user.storeId !== storeId) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: { active: true },
    });

    return { success: true };
  }

  async deactivate(id: string, storeId: string) {
    const user = await this.findById(id);
    if (user.storeId !== storeId) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id },
      data: { active: false },
    });

    return { success: true };
  }

  async upsertBulk(users: { id: string; phone: string; password: string; nameUz: string; nameRu: string; role?: string; active?: boolean }[], storeId: string) {
    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const u of users) {
      try {
        const existing = await this.prisma.user.findUnique({
          where: { storeId_phone: { storeId, phone: u.phone } },
        });

        if (existing) {
          await this.prisma.user.update({
            where: { id: existing.id },
            data: {
              nameUz: u.nameUz,
              nameRu: u.nameRu,
              role: (u.role as any) || existing.role,
              active: u.active ?? existing.active,
            },
          });
          updated++;
        } else {
          await this.prisma.user.create({
            data: {
              id: u.id,
              storeId,
              phone: u.phone,
              password: u.password,
              nameUz: u.nameUz,
              nameRu: u.nameRu,
              role: (u.role as any) || 'USER',
              active: u.active ?? true,
            },
          });
          created++;
        }
      } catch (err) {
        errors.push(`phone=${u.phone}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { created, updated, errors };
  }

  async updatePassword(id: string, hashedPassword: string) {
    return this.prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
  }

  async delete(id: string, storeId: string) {
    const user = await this.findById(id);
    if (user.storeId !== storeId) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.delete({
      where: { id },
    });

    return { success: true };
  }
}
