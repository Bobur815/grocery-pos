import { getPrismaClient } from '../database/sqlite-client';
import { getAppConfig } from '../config/app-config';
import { getServerToken } from './queue-manager';
import { isCashTender } from '../../shared/constants';

const BATCH_SIZE = 20;

export interface SmenaSyncResult {
  totalUnsynced: number;
  succeeded: number;
  failed: number;
  skippedReason?: string;
  errors: string[];
}

type ShiftTotals = {
  cashSalesAmount: number;
  cardSalesAmount: number;
  payInTotal: number;
  payOutTotal: number;
  returnAmount: number;
};

/**
 * Per-shift money totals, computed HERE rather than on the server.
 *
 * This is the whole reason the sync carries a snapshot: a return deletes its Sale row on the
 * VPS, so once a cashier processes one the server can never reconstruct that shift's takings.
 * The terminal that owned the drawer is the only place the figure exists.
 *
 * Mirrors computeSmenaStats() in smena-handlers.ts — same queries, same cash/cashless split —
 * but returns only the fields the server stores.
 */
async function computeShiftTotals(smenaId: string): Promise<ShiftTotals> {
  const prisma = getPrismaClient();

  type SalesRow = { payment_method: string; total: number };
  const salesRows = (await prisma.$queryRawUnsafe(
    `SELECT payment_method, COALESCE(SUM(final_amount), 0) as total
     FROM sales WHERE smena_id = ? GROUP BY payment_method`,
    smenaId,
  )) as SalesRow[];

  let cashSalesAmount = 0;
  let cardSalesAmount = 0;
  for (const row of salesRows) {
    // Cash is the only tender that lands in the drawer; card and UzQR settle to the bank.
    // Keyed on "is it cash" so a future tender is never counted as money in the till.
    if (isCashTender(row.payment_method)) cashSalesAmount += Number(row.total);
    else cardSalesAmount += Number(row.total);
  }

  type MovRow = { type: string; total: number };
  const movRows = (await prisma.$queryRawUnsafe(
    `SELECT type, COALESCE(SUM(amount), 0) as total
     FROM smena_movements WHERE smena_id = ? GROUP BY type`,
    smenaId,
  )) as MovRow[];

  let payInTotal = 0;
  let payOutTotal = 0;
  for (const row of movRows) {
    if (row.type === 'PAY_IN') payInTotal = Number(row.total);
    else if (row.type === 'PAY_OUT') payOutTotal = Number(row.total);
  }

  // Returns are audit-log entries, not rows in `sales` — the sale itself is gone by now.
  type ReturnRow = { total: number };
  const returnRows = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(CAST(json_extract(details, '$.finalAmount') AS REAL)), 0) as total
     FROM audit_logs
     WHERE action = 'delete_sale' AND json_extract(details, '$.smenaId') = ?`,
    smenaId,
  )) as ReturnRow[];

  const returnAmount = returnRows.length > 0 ? Number(returnRows[0].total) : 0;

  return { cashSalesAmount, cardSalesAmount, payInTotal, payOutTotal, returnAmount };
}

/**
 * Push closed shifts to the VPS so money reconciliation can see physical cash.
 *
 * Only CLOSED shifts are eligible: an open one has no `finalCash`, and there is nothing to
 * reconcile until the drawer has been counted out.
 */
export async function syncSmenas(): Promise<SmenaSyncResult> {
  const prisma = getPrismaClient();
  const config = getAppConfig();
  const result: SmenaSyncResult = { totalUnsynced: 0, succeeded: 0, failed: 0, errors: [] };

  const pending = await prisma.smena.findMany({
    where: { synced: false, status: 'CLOSED' },
    include: { movements: true },
    take: BATCH_SIZE,
    orderBy: { closedAt: 'asc' },
  });

  result.totalUnsynced = pending.length;
  if (pending.length === 0) return result;

  const token = getServerToken();
  if (!token) {
    result.skippedReason = 'no_server_token';
    return result;
  }

  const payload = [];
  for (const s of pending) {
    // Defensive: a CLOSED shift with no finalCash would be a local data bug, and uploading it
    // would put a null into the one column this whole feature exists to record.
    if (s.finalCash === null) {
      result.errors.push(`${s.id} → CLOSED but finalCash is null, skipped`);
      continue;
    }
    const totals = await computeShiftTotals(s.id);
    payload.push({
      id: s.id,
      terminalId: config.terminalId || s.terminalId,
      cashierId: s.cashierId,
      cashierName: s.cashierName || s.cashierId,
      initialCash: s.initialCash.toString(),
      finalCash: s.finalCash.toString(),
      zReportNumber: s.zReportNumber,
      regosZReportId: s.regosZReportId ?? undefined,
      cashSalesAmount: String(totals.cashSalesAmount),
      cardSalesAmount: String(totals.cardSalesAmount),
      payInTotal: String(totals.payInTotal),
      payOutTotal: String(totals.payOutTotal),
      returnAmount: String(totals.returnAmount),
      openedAt: s.openedAt.toISOString(),
      closedAt: (s.closedAt ?? new Date()).toISOString(),
      movements: s.movements.map((m: (typeof s.movements)[number]) => ({
        id: m.id,
        type: m.type,
        amount: m.amount.toString(),
        note: m.note ?? undefined,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  }

  if (payload.length === 0) {
    result.failed = result.errors.length;
    return result;
  }

  try {
    const response = await fetch(`${config.vpsApiUrl}/smena/sync-bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ smenas: payload }),
    });

    if (!response.ok) {
      const text = await response.text();
      const msg = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      console.error(`[smena-sync] Failed to sync shifts: ${msg}`);
      result.errors.push(msg);
      result.failed = payload.length;
      return result;
    }

    // The server upserts on the terminal's own shift id, so marking synced here is safe even if
    // an earlier attempt already landed — a re-send updates the same row rather than doubling it.
    await prisma.smena.updateMany({
      where: { id: { in: payload.map((p) => p.id) } },
      data: { synced: true },
    });

    result.succeeded = payload.length;
    console.log(`[smena-sync] Done: ${payload.length} shifts synced`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[smena-sync] Error syncing shifts: ${msg}`);
    result.errors.push(msg);
    result.failed = payload.length;
  }

  return result;
}
