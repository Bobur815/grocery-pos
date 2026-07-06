import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getAll(storeId: string): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { storeId },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async get(storeId: string, key: string): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { storeId_key: { storeId, key } },
    });
    return row?.value ?? null;
  }

  async set(storeId: string, key: string, value: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { storeId_key: { storeId, key } },
      update: { value },
      create: { storeId, key, value },
    });
  }

  async delete(storeId: string, key: string): Promise<void> {
    // deleteMany (not delete) so removing an absent key is a no-op instead of throwing.
    await this.prisma.systemSetting.deleteMany({ where: { storeId, key } });
  }
}
