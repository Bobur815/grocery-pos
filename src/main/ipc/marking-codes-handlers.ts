import { ipcMain } from 'electron';
import { getPrismaClient } from '../database/sqlite-client';
import { getAppConfig } from '../config/app-config';
import { getServerToken } from '../sync/queue-manager';
import { classifyCirculation } from '../../shared/utils/circulation';

interface MarkingCodeCheckResult {
  alreadySold: boolean;
  soldAt?: string;
  terminalId?: string;
  source?: 'local' | 'server';
}

interface MarkingCirculationResult {
  // false when asl-belgisi could not be consulted (offline / no token / error). Callers follow
  // the offline-first rule: do NOT block the sale when unreachable — REGOS:VCR remains the
  // authoritative check at fiscalization.
  reachable: boolean;
  // true only when asl-belgisi positively says the code may not be sold: it is out of circulation
  // (WITHDRAWN / SOLD / RETIRED / EMITTED / …) or not present in the registry at all.
  outOfCirculation: boolean;
  status?: string; // raw asl-belgisi status (or 'NOT_FOUND'), for the cashier message
}

interface MarkingCodeEntry {
  code: string;
  productBarcode?: string;
}

export interface PendingMarkingCodeEntry {
  code: string;
  productBarcode?: string;
  saleId?: string;
}

export function setupMarkingCodesHandlers(): void {
  // Check if a marking code has been sold (local SQLite first, then server)
  ipcMain.handle('markingCodes:check', async (_event, code: string): Promise<MarkingCodeCheckResult> => {
    const prisma = getPrismaClient();

    // 1. Check local SQLite
    const local = await (prisma as any).soldMarkingCode.findUnique({
      where: { code },
    });

    if (local) {
      return {
        alreadySold: true,
        soldAt: local.soldAt instanceof Date ? local.soldAt.toISOString() : String(local.soldAt),
        terminalId: local.terminalId,
        source: 'local',
      };
    }

    // 2. Check server (cross-terminal)
    const config = getAppConfig();
    const token = getServerToken();
    if (!token) return { alreadySold: false };

    try {
      const response = await fetch(
        `${config.vpsApiUrl}/marking-codes/check?code=${encodeURIComponent(code)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          // Short ceiling: this now runs in the background behind an optimistic cart add, and the
          // error path is offline-first "allow sale", so a flaky link should fail fast, not hang.
          signal: AbortSignal.timeout(1500),
        },
      );
      if (!response.ok) return { alreadySold: false };
      const result = await response.json();
      if (result.alreadySold) {
        return {
          alreadySold: true,
          soldAt: result.soldAt,
          terminalId: result.terminalId,
          source: 'server',
        };
      }
    } catch {
      // Server unreachable — allow sale (offline-first fallback)
    }

    return { alreadySold: false };
  });

  // Check a group-022 marking code's CIRCULATION status against asl-belgisi (distinct from the
  // resale check above). Used during a sale to block an out-of-circulation code early with a clear
  // message, instead of letting REGOS:VCR reject the whole receipt at fiscalization ([704030]
  // "товар вне оборота"). Offline-first: when asl-belgisi is unreachable we report
  // outOfCirculation=false so the sale proceeds and REGOS stays the authoritative gate.
  ipcMain.handle(
    'markingCodes:checkCirculation',
    async (_event, code: string): Promise<MarkingCirculationResult> => {
      const { status, isValid, reachable } = await verifyCirculation(code);
      if (!reachable) return { reachable: false, outOfCirculation: false };
      // isValid===false → the code is unknown to the registry (will fail REGOS). Otherwise classify
      // its status; only a confirmed OUT verdict blocks. An UNKNOWN status is NOT blocked here
      // (avoid false positives from unrecognised status strings) — REGOS will catch it if invalid.
      if (isValid === false) {
        return { reachable: true, outOfCirculation: true, status: 'NOT_FOUND' };
      }
      return {
        reachable: true,
        outOfCirculation: classifyCirculation(status) === 'OUT',
        status,
      };
    },
  );

  // Free the marking codes tied to a sale (called when a sale is deleted or refunded) so the
  // group-022 items can be sold again. The codes are gathered from both the sale's regosLabels
  // snapshot and the pending-codes table (which carries saleId), then removed from
  // sold_marking_codes (and pending_marking_codes). Best-effort, local-only.
  ipcMain.handle('markingCodes:removeForSale', async (_event, saleId: string): Promise<void> => {
    if (!saleId) return;
    const prisma = getPrismaClient();

    const codes = new Set<string>();

    // 1. From the sale's snapshot of scanned labels (set when fiscalization is enabled).
    try {
      const sale = await (prisma as any).sale.findUnique({
        where: { id: saleId },
        select: { regosLabels: true },
      });
      if (sale?.regosLabels) {
        const labels = JSON.parse(sale.regosLabels) as Array<{ label?: string }>;
        for (const l of labels) if (l?.label) codes.add(l.label);
      }
    } catch {
      // ignore missing sale / malformed snapshot
    }

    // 2. From pending codes, which are keyed by saleId.
    try {
      const pending = await (prisma as any).pendingMarkingCode.findMany({ where: { saleId } });
      for (const p of pending) if (p?.code) codes.add(p.code);
    } catch {
      // ignore
    }

    if (codes.size === 0) return;
    const codeList = [...codes];

    // 1. Free locally so this terminal can sell the items again immediately.
    await (prisma as any).soldMarkingCode
      .deleteMany({ where: { code: { in: codeList } } })
      .catch(() => {});
    await (prisma as any).pendingMarkingCode
      .deleteMany({ where: { code: { in: codeList } } })
      .catch(() => {});

    // 2. Release on the server too, so other terminals stop seeing the codes as sold.
    const config = getAppConfig();
    const token = getServerToken();
    if (!token) return;
    try {
      await fetch(`${config.vpsApiUrl}/marking-codes/release`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ codes: codeList }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      // Best-effort: the local release already happened; server stays consistent on next sync.
    }
  });

  // Record marking codes as sold (called after sale completes)
  ipcMain.handle(
    'markingCodes:record',
    async (_event, entries: MarkingCodeEntry[]): Promise<void> => {
      if (!entries || entries.length === 0) return;

      const prisma = getPrismaClient();
      const config = getAppConfig();
      const terminalId = config.terminalId || 'unknown';
      const token = getServerToken();

      // 1. Write to local SQLite (best-effort, ignore conflicts)
      for (const entry of entries) {
        try {
          await (prisma as any).soldMarkingCode.upsert({
            where: { code: entry.code },
            create: {
              code: entry.code,
              productBarcode: entry.productBarcode ?? null,
              terminalId,
              synced: false,
            },
            update: {}, // already exists — don't overwrite
          });
        } catch {
          // ignore duplicate constraint errors
        }
      }

      // 2. Background sync to server
      if (!token) return;

      try {
        const response = await fetch(`${config.vpsApiUrl}/marking-codes/record`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            codes: entries.map((e) => ({
              code: e.code,
              productBarcode: e.productBarcode,
              soldAt: new Date().toISOString(),
            })),
            terminalId,
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (response.ok) {
          // Mark as synced in local SQLite
          for (const entry of entries) {
            await (prisma as any).soldMarkingCode.updateMany({
              where: { code: entry.code },
              data: { synced: true },
            }).catch(() => {});
          }
        }
      } catch {
        // Will be picked up by future sync if needed
      }
    },
  );
}

/**
 * Ask the VPS asl-belgisi proxy for a marking code's circulation status.
 * Returns `reachable: false` when the server can't be consulted (offline / no token /
 * error) so callers can apply the offline-first "save anyway" rule.
 */
async function verifyCirculation(
  code: string,
): Promise<{ status?: string; isValid?: boolean; reachable: boolean }> {
  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return { reachable: false };
  try {
    const res = await fetch(`${config.vpsApiUrl}/aslbelgisi/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { reachable: false };
    const data = (await res.json()) as { isValid?: boolean; status?: string };
    return { status: data.status, isValid: data.isValid, reachable: true };
  } catch {
    return { reachable: false };
  }
}

/**
 * Capture group-022 marking codes that were sold while still IN circulation, so they can
 * later be sent to a REGOS:VCR to be taken out of circulation. Called after a sale completes
 * (there is no VCR connected yet). Rules:
 *   - Skip a code ONLY when asl-belgisi positively reports it OUT of circulation.
 *   - Save it when IN circulation, status unknown, or asl-belgisi is unreachable (offline-first).
 * Writes locally (SQLite) first, then best-effort syncs to the VPS for cross-terminal consistency.
 */
export async function savePendingMarkingCodes(
  entries: PendingMarkingCodeEntry[],
): Promise<void> {
  if (!entries || entries.length === 0) return;

  const prisma = getPrismaClient();
  const config = getAppConfig();
  const terminalId = config.terminalId || 'unknown';
  const token = getServerToken();

  const toSync: Array<{
    code: string;
    productBarcode?: string;
    saleId?: string;
    circulationStatus: string | null;
  }> = [];

  for (const entry of entries) {
    if (!entry?.code) continue;

    const { status, reachable } = await verifyCirculation(entry.code);
    // Only a confirmed OUT status excludes the code; everything else is saved.
    if (reachable && classifyCirculation(status) === 'OUT') continue;

    try {
      await (prisma as any).pendingMarkingCode.upsert({
        where: { code: entry.code },
        create: {
          code: entry.code,
          productBarcode: entry.productBarcode ?? null,
          saleId: entry.saleId ?? null,
          terminalId,
          circulationStatus: status ?? null,
          synced: false,
        },
        update: {}, // first capture wins — don't overwrite
      });
      toSync.push({
        code: entry.code,
        productBarcode: entry.productBarcode,
        saleId: entry.saleId,
        circulationStatus: status ?? null,
      });
    } catch {
      // ignore duplicate constraint errors
    }
  }

  if (!token || toSync.length === 0) return;

  try {
    const response = await fetch(`${config.vpsApiUrl}/marking-codes/pending`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ codes: toSync, terminalId }),
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      for (const e of toSync) {
        await (prisma as any).pendingMarkingCode
          .updateMany({ where: { code: e.code }, data: { synced: true } })
          .catch(() => {});
      }
    }
  } catch {
    // left synced=false; best-effort, matches soldMarkingCode behavior
  }
}
