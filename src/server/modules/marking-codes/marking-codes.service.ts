import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface RecordEntry {
  code: string;
  productBarcode?: string;
  soldAt?: string;
}

interface PendingEntry {
  code: string;
  productBarcode?: string;
  saleId?: string;
  circulationStatus?: string | null;
}

@Injectable()
export class MarkingCodesService {
  constructor(private prisma: PrismaService) {}

  async check(storeId: string, code: string) {
    const record = await (this.prisma as any).soldMarkingCode.findFirst({
      where: { storeId, code },
      select: { soldAt: true, terminalId: true },
    });

    if (record) {
      return {
        alreadySold: true,
        soldAt: record.soldAt.toISOString(),
        terminalId: record.terminalId,
      };
    }

    return { alreadySold: false };
  }

  async record(
    storeId: string,
    entries: RecordEntry[],
    terminalId: string,
  ): Promise<{ recorded: number; conflicts: string[] }> {
    let recorded = 0;
    const conflicts: string[] = [];

    for (const entry of entries) {
      try {
        await (this.prisma as any).soldMarkingCode.create({
          data: {
            storeId,
            code: entry.code,
            productBarcode: entry.productBarcode ?? null,
            terminalId,
            soldAt: entry.soldAt ? new Date(entry.soldAt) : new Date(),
          },
        });
        recorded++;
      } catch {
        // Unique constraint violation — already sold (possibly by another terminal)
        conflicts.push(entry.code);
      }
    }

    return { recorded, conflicts };
  }

  /**
   * Release marking codes (delete from sold + pending) so the items can be sold again on any
   * terminal. Called when a sale is deleted or refunded. Scoped to the store.
   */
  async release(storeId: string, codes: string[]): Promise<{ released: number }> {
    const list = (codes ?? []).filter((c): c is string => !!c);
    if (list.length === 0) return { released: 0 };

    const [sold] = await Promise.all([
      (this.prisma as any).soldMarkingCode.deleteMany({
        where: { storeId, code: { in: list } },
      }),
      (this.prisma as any).pendingMarkingCode.deleteMany({
        where: { storeId, code: { in: list } },
      }),
    ]);

    return { released: sold.count };
  }

  /**
   * Record group-022 marking codes that were sold while still IN circulation, captured for
   * later REGOS:VCR out-of-circulation fiscalization. First capture per (store, code) wins.
   */
  async recordPending(
    storeId: string,
    entries: PendingEntry[],
    terminalId: string,
  ): Promise<{ recorded: number }> {
    let recorded = 0;

    for (const entry of entries) {
      if (!entry?.code) continue;
      await (this.prisma as any).pendingMarkingCode.upsert({
        where: { storeId_code: { storeId, code: entry.code } },
        create: {
          storeId,
          code: entry.code,
          productBarcode: entry.productBarcode ?? null,
          saleId: entry.saleId ?? null,
          terminalId,
          circulationStatus: entry.circulationStatus ?? null,
        },
        update: {}, // first capture wins — don't overwrite
      });
      recorded++;
    }

    return { recorded };
  }

  /** List pending (not-yet-fiscalized) marking codes for a store (admin/audit visibility). */
  async listPending(storeId: string) {
    return (this.prisma as any).pendingMarkingCode.findMany({
      where: { storeId, fiscalized: false },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
