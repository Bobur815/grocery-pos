import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { UploadLogsDto } from './dto/upload-logs.dto';
import { UploadAuditLogsDto } from './dto/upload-audit-logs.dto';

// Logs are diagnostic/audit trails, not source-of-truth — keep ~1 month and purge the rest
// nightly so terminal_logs and audit_logs don't grow unbounded.
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

export interface AuditLogsQuery {
  storeId?: string;
  phone?: string;
  action?: string;
  entity?: string;
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
   * Nightly retention sweep — drops terminal_logs and audit_logs older than the retention window
   * across all stores. Replaces the previous opportunistic per-store purge in uploadLogs (which
   * ran on every upload and never touched audit_logs, letting that table grow unbounded).
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'log-retention' })
  async purgeOldLogs(): Promise<void> {
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const [terminal, audit] = await Promise.all([
      this.prisma.terminalLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
      this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    ]);
    this.logger.log(
      `Log retention: purged ${terminal.count} terminal_logs + ${audit.count} audit_logs older than ${LOG_RETENTION_DAYS}d`,
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

  async uploadAuditLogs(storeId: string, dto: UploadAuditLogsDto): Promise<{ saved: number }> {
    if (!dto.entries.length) return { saved: 0 };

    await this.prisma.auditLog.createMany({
      data: dto.entries.map(e => ({
        id: e.id,
        storeId,
        userId: e.userId,
        phone: e.phone,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        details: e.details ?? null,
        createdAt: new Date(e.createdAt),
      })),
      skipDuplicates: true,
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

  async getAuditLogsMeta(callerRole: string, callerStoreId: string | null) {
    const where = callerRole !== 'SUPER_ADMIN' ? { storeId: callerStoreId ?? undefined } : {};

    const [storeRows, actionRows, entityRows] = await Promise.all([
      callerRole === 'SUPER_ADMIN'
        ? this.prisma.auditLog.findMany({ select: { storeId: true }, distinct: ['storeId'] })
        : [],
      this.prisma.auditLog.findMany({ where, select: { action: true }, distinct: ['action'], orderBy: { action: 'asc' } }),
      this.prisma.auditLog.findMany({ where, select: { entity: true }, distinct: ['entity'], orderBy: { entity: 'asc' } }),
    ]);

    return {
      stores: storeRows.map((r: { storeId: string }) => r.storeId),
      actions: actionRows.map((r: { action: string }) => r.action),
      entities: entityRows.map((r: { entity: string }) => r.entity),
    };
  }

  async getAuditLogs(callerRole: string, callerStoreId: string | null, query: AuditLogsQuery) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};

    if (callerRole !== 'SUPER_ADMIN') {
      where.storeId = callerStoreId;
    } else if (query.storeId) {
      where.storeId = query.storeId;
    }

    if (query.phone) where.phone = { contains: query.phone };
    if (query.action) where.action = query.action;
    if (query.entity) where.entity = query.entity;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, items] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { store: { select: { name: true } } },
      }),
    ]);

    return { items, total, page, limit, pages: Math.ceil(total / limit) };
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
