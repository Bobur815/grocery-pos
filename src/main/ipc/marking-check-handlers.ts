// IPC for the staff-facing Marking Check screen (/marking-check).
//
// Separate from marking-codes-handlers.ts on purpose: those handlers serve the SALE path (fast,
// offline-first, "may this go in the cart?"). This one serves a human standing at the terminal who
// deliberately wants to interrogate a code, so it trades speed for detail and reports WHY a lookup
// failed instead of silently degrading to "allow".
//
// Oracle is asl-belgisi (via the VPS proxy). REGOS's Ofd/CheckLabel was evaluated and rejected: it
// answers isValid=true for tampered serials, garbage labels and bogus ICPS, so it cannot tell a
// good code from a bad one.
import { ipcMain } from 'electron';
import {
  verifyMarkingCodeDetails,
  getMarkingApiKeyStatus,
  setMarkingApiKey,
  type MarkingCodeLookup,
  type MarkingApiKeyResult,
} from '../marking/circulation-check';
import { classifyCirculation, type CirculationVerdict } from '../../shared/utils/circulation';
import { extractGtinFromDataMatrix, toSoldCodeKey } from '../../shared/utils/marking';
import { getPrismaClient } from '../database/sqlite-client';

export interface MarkingCheckResult extends MarkingCodeLookup {
  /** IN / OUT / UNKNOWN, derived from the registry status. */
  verdict: CirculationVerdict;
  /** EAN-13 parsed out of AI 01, when the input was a DataMatrix. */
  gtin?: string;
  /** Matching product from the local catalogue, when the GTIN is one we stock. */
  product?: {
    id: string;
    nameUz: string;
    nameRu: string;
    barcode: string | null;
    mxik: string | null;
  };
  /** Set when this terminal (or the server) has already recorded the code as sold. */
  alreadySold?: { soldAt?: string; terminalId?: string };
}

export function setupMarkingCheckHandlers(): void {
  ipcMain.handle(
    'markingCheck:verify',
    async (_event, rawCode: string): Promise<MarkingCheckResult> => {
      const lookup = await verifyMarkingCodeDetails(rawCode);
      const verdict = lookup.reachable
        ? lookup.details?.isValid === false
          ? 'OUT' // not present in the registry at all — treat as not sellable
          : classifyCirculation(lookup.details?.status)
        : 'UNKNOWN';

      const gtin = extractGtinFromDataMatrix(rawCode) ?? undefined;

      // Best-effort local enrichment — never let a catalogue miss fail the check.
      let product: MarkingCheckResult['product'];
      if (gtin) {
        try {
          const prisma = getPrismaClient();
          const row = await prisma.product.findFirst({
            where: { barcode: gtin },
            select: { id: true, nameUz: true, nameRu: true, barcode: true, mxik: true },
          });
          if (row) product = row;
        } catch {
          // ignore — the registry answer is what matters
        }
      }

      // Surface a prior sale of this exact code: the commonest real-world cause of a REGOS
      // rejection is a code that was already sold on this or another terminal.
      // Query by toSoldCodeKey(), NOT the asl-belgisi lookup key — the sale path stores the code
      // with its crypto tail intact, so the stripped form would never match.
      let alreadySold: MarkingCheckResult['alreadySold'];
      const soldKey = toSoldCodeKey(rawCode);
      if (soldKey) {
        try {
          const prisma = getPrismaClient();
          const sold = await (prisma as any).soldMarkingCode.findUnique({
            where: { code: soldKey },
          });
          if (sold) {
            alreadySold = {
              soldAt:
                sold.soldAt instanceof Date ? sold.soldAt.toISOString() : String(sold.soldAt),
              terminalId: sold.terminalId,
            };
          }
        } catch {
          // ignore
        }
      }

      return { ...lookup, verdict, gtin, product, alreadySold };
    },
  );

  // Key rotation: asl-belgisi issues business-account keys for 3 months, and a dead key silently
  // turns every check into "не проверено". Admins rotate it from the same screen that reports it.
  ipcMain.handle(
    'markingCheck:apiKeyStatus',
    async (): Promise<MarkingApiKeyResult> => getMarkingApiKeyStatus(),
  );

  ipcMain.handle(
    'markingCheck:setApiKey',
    async (_event, key: string): Promise<MarkingApiKeyResult> => setMarkingApiKey(key),
  );
}
