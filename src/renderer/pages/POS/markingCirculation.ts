// Synchronous pre-payment circulation guard for group-020/022 marked cart lines.
//
// Used by both the Checkout modal and POSScreen quick-pay so an out-of-circulation marking code
// (e.g. WITHDRAWN / already SOLD) is caught BEFORE the sale is created — closing the race where a
// cashier pays immediately after scanning, before the optimistic scan-time check in POSScreen has
// resolved. Without this, such a sale only fails later at REGOS:VCR fiscalization with
// [704030] "товар вне оборота".
//
// Offline-first: codes whose status could not be confirmed (asl-belgisi unreachable) are NOT
// blocked here — REGOS remains the authoritative gate — matching the scan-time check.

export interface BlockedMarkingItem {
  code: string;
  productName: string;
  status?: string;
}

/**
 * Verify every marked cart line's asl-belgisi circulation status in parallel and return the lines
 * that are confirmed out of circulation (reachable && outOfCirculation). Lines without a marking
 * code, and lines whose registry status could not be confirmed, are not returned.
 */
export async function findBlockedMarkingItems(
  items: { markingCode?: string; productName: string }[],
): Promise<BlockedMarkingItem[]> {
  const marked = items.filter((i) => i.markingCode);
  if (marked.length === 0) return [];

  const results = await Promise.all(
    marked.map(async (i): Promise<BlockedMarkingItem | null> => {
      try {
        const r = await window.electronAPI.markingCodes.checkCirculation(i.markingCode!);
        if (r.reachable && r.outOfCirculation) {
          return { code: i.markingCode!, productName: i.productName, status: r.status };
        }
      } catch {
        // unreachable / IPC error — allow (offline-first); REGOS stays the gate
      }
      return null;
    }),
  );

  return results.filter((x): x is BlockedMarkingItem => x !== null);
}

/**
 * Localize an asl-belgisi circulation status enum (WITHDRAWN, SOLD, NOT_FOUND, …) via the
 * `pos.markingStatus.*` keys, falling back to the raw value when a status is not mapped.
 */
export function translateMarkingStatus(
  status: string | undefined,
  t: (key: string) => string,
): string {
  if (!status) return "—";
  const key = `pos.markingStatus.${status.toUpperCase()}`;
  const translated = t(key);
  return translated === key ? status : translated; // i18next returns the key when missing
}
