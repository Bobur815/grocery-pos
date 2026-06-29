import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadLogsDto } from './dto/upload-logs.dto';

// Terminal logs are diagnostic, not source-of-truth — keep ~1 month and purge the rest nightly so
// terminal_logs doesn't grow unbounded.
const LOG_RETENTION_DAYS = 30;

export interface LogsQuery {
  storeId?: string;
  terminalId?: string;
  level?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nightly retention sweep — drops terminal_logs older than the retention window across all
   * stores so the table doesn't grow unbounded.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'log-retention' })
  async purgeOldLogs(): Promise<void> {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const terminal = await this.prisma.terminalLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    this.logger.log(
      `Log retention: purged ${terminal.count} terminal_logs older than ${LOG_RETENTION_DAYS}d`,
    );
  }

  async uploadLogs(storeId: string, dto: UploadLogsDto): Promise<{ saved: number }> {
    if (!dto.entries.length) return { saved: 0 };

    await this.prisma.terminalLog.createMany({
      data: dto.entries.map(e => ({
        storeId,
        terminalId: dto.terminalId,
        level: e.level,
        message: e.msg,
        timestamp: new Date(e.ts),
      })),
    });

    return { saved: dto.entries.length };
  }

  async getMeta(
    callerRole: string,
    callerStoreId: string | null,
  ): Promise<{ stores: string[]; terminalsByStore: Record<string, string[]> }> {
    const where: Record<string, unknown> = {};
    if (callerRole !== 'SUPER_ADMIN') {
      where.storeId = callerStoreId;
    }

    const rows = await this.prisma.terminalLog.findMany({
      where,
      select: { storeId: true, terminalId: true },
      distinct: ['storeId', 'terminalId'],
      orderBy: [{ storeId: 'asc' }, { terminalId: 'asc' }],
    });

    const terminalsByStore: Record<string, string[]> = {};
    for (const row of rows) {
      if (!terminalsByStore[row.storeId]) terminalsByStore[row.storeId] = [];
      terminalsByStore[row.storeId].push(row.terminalId);
    }

    return { stores: Object.keys(terminalsByStore).sort(), terminalsByStore };
  }

  async getLogs(
    callerRole: string,
    callerStoreId: string | null,
    query: LogsQuery,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    // SUPER_ADMIN may query any store or pass a specific storeId filter
    if (callerRole !== 'SUPER_ADMIN') {
      where.storeId = callerStoreId;
    } else if (query.storeId) {
      where.storeId = query.storeId;
    }

    if (query.terminalId) where.terminalId = query.terminalId;
    if (query.level && query.level !== 'all') where.level = query.level;
    if (query.from || query.to) {
      where.timestamp = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.terminalLog.count({ where }),
      this.prisma.terminalLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          storeId: true,
          terminalId: true,
          level: true,
          message: true,
          timestamp: true,
        },
      }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }
}
