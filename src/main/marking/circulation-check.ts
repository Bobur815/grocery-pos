// Shared asl-belgisi circulation check for the main process. Used by the marking-code IPC handlers
// (POS scan-time / checkout guards) and by the bulk "fiscalize old receipts" admin action, so the
// fiscal service does not have to depend on the IPC-handlers module.
//
// The actual asl-belgisi request goes through the VPS proxy (POST /aslbelgisi/verify → xtrace.
// aslbelgisi.uz), which strips the crypto tail and returns { isValid, status }. We classify the
// status with classifyCirculation() from the shared utils.
import { getAppConfig } from '../config/app-config';
import { getServerToken } from '../sync/queue-manager';
import { classifyCirculation } from '../../shared/utils/circulation';

export interface CirculationVerifyResult {
  status?: string;
  isValid?: boolean;
  reachable: boolean;
}

export interface OutOfCirculationResult {
  // false when asl-belgisi could not be consulted (offline / no token / error). Callers follow the
  // offline-first rule: never block/disable on an unreachable registry — REGOS:VCR remains the
  // authoritative check at fiscalization.
  reachable: boolean;
  // true only when asl-belgisi positively says the code may not be sold: out of circulation
  // (WITHDRAWN / SOLD / RETIRED / EMITTED / …) or not present in the registry at all.
  outOfCirculation: boolean;
  status?: string; // raw asl-belgisi status (or 'NOT_FOUND'), for the cashier/admin message
}

/**
 * Ask the VPS asl-belgisi proxy for a marking code's circulation status. Returns `reachable: false`
 * when the server can't be consulted (offline / no token / error) so callers can apply the
 * offline-first rule.
 */
export async function verifyCirculation(code: string): Promise<CirculationVerifyResult> {
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
 * Decide whether a marking code may NOT be sold/fiscalized. Out of circulation when the registry
 * has no record of it (isValid === false → 'NOT_FOUND') or its status classifies as OUT. An
 * unrecognised/UNKNOWN status is NOT treated as out (avoid false positives) — REGOS will catch it.
 */
export async function isCodeOutOfCirculation(code: string): Promise<OutOfCirculationResult> {
  const { status, isValid, reachable } = await verifyCirculation(code);
  if (!reachable) return { reachable: false, outOfCirculation: false };
  if (isValid === false) return { reachable: true, outOfCirculation: true, status: 'NOT_FOUND' };
  return { reachable: true, outOfCirculation: classifyCirculation(status) === 'OUT', status };
}
