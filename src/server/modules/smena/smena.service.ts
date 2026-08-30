import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SyncSmenaDto } from './dto/sync-smena.dto';

export interface SmenaSyncResult {
  synced: number;
  skipped: number;
}

@Injectable()
export class SmenaService {
  private readonly logger = new Logger(SmenaService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Mirror closed shifts up from a terminal.
   *
   * Idempotent by construction: the terminal's own shift id is the primary key, so a retry after
   * a dropped response updates the same row instead of creating a second shift. That matters
   * more here than for sales — a duplicated shift would double the period's expected cash and
   * report a shortage the size of a full day's takings.
   */
  async syncFromTerminal(
    storeId: string,
    smenas: SyncSmenaDto[],
  ): Promise<SmenaSyncResult> {
    let synced = 0;
    let skipped = 0;

    for (const s of smenas) {
      try {
        await this.upsertOne(storeId, s);
        synced++;
      } catch (err) {
        // One malformed shift must not cost the terminal the rest of the batch — it would
        // retry the whole set forever and never drain the queue.
        this.logger.error(
          `Failed to sync smena ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        skipped++;
      }
    }

    return { synced, skipped };
  }

  private async upsertOne(storeId: string, s: SyncSmenaDto): Promise<void> {
    const data = {
      storeId,
      terminalId: s.terminalId,
      cashierId: s.cashierId,
      cashierName: s.cashierName,
      status: 'CLOSED',
      initialCash: new Prisma.Decimal(s.initialCash),
      finalCash: new Prisma.Decimal(s.finalCash),
      zReportNumber: s.zReportNumber,
      regosZReportId: s.regosZReportId ?? null,
      cashSalesAmount: new Prisma.Decimal(s.cashSalesAmount),
      cardSalesAmount: new Prisma.Decimal(s.cardSalesAmount),
      payInTotal: new Prisma.Decimal(s.payInTotal),
      payOutTotal: new Prisma.Decimal(s.payOutTotal),
      returnAmount: new Prisma.Decimal(s.returnAmount),
      openedAt: new Date(s.openedAt),
      closedAt: new Date(s.closedAt),
      syncedAt: new Date(),
    };

    // Movements are replaced wholesale rather than merged: the terminal's set is authoritative,
    // and a movement voided locally between two sync attempts has to disappear here too.
    await this.prisma.$transaction([
      this.prisma.smena.upsert({
        where: { id: s.id },
        create: { id: s.id, ...data },
        update: data,
      }),
      this.prisma.smenaMovement.deleteMany({ where: { smenaId: s.id } }),
      this.prisma.smenaMovement.createMany({
        data: s.movements.map((m) => ({
          id: m.id,
          smenaId: s.id,
          type: m.type,
          amount: new Prisma.Decimal(m.amount),
          note: m.note ?? null,
          createdAt: new Date(m.createdAt),
        })),
      }),
    ]);
  }

  async findAll(storeId: string, from?: Date, to?: Date) {
    return this.prisma.smena.findMany({
      where: {
        storeId,
        ...(from || to
          ? { closedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: { closedAt: 'desc' },
      include: { movements: true },
    });
  }
}
