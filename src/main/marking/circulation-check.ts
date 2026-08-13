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
import { normalizeDataMatrix, stripCryptoTail } from '../../shared/utils/marking';

export interface CirculationVerifyResult {
  status?: string;
  isValid?: boolean;
  reachable: boolean;
}

/** Full asl-belgisi record for one marking code, as returned by the VPS proxy. */
export interface MarkingCodeDetails {
  isValid: boolean;
  status?: string;
  extendedStatus?: string;
  gtin?: string;
  productId?: string;
  productionDate?: string;
  expirationDate?: string;
  productSeries?: string;
  packageType?: string;
  issuerName?: string;
}

export interface MarkingCodeLookup {
  /** false when the registry could not be consulted (offline / no token / server error). */
  reachable: boolean;
  /** The code actually sent to the registry (crypto tail stripped) — shown for support. */
  lookupCode?: string;
  details?: MarkingCodeDetails;
  /** Machine-readable reason the lookup failed, when reachable === false (see normalizeError). */
  error?: string;
}

/** Server-side state of the asl-belgisi API key, as reported by GET /aslbelgisi/api-key. */
export interface MarkingApiKeyStatus {
  configured: boolean;
  source: 'store' | 'env' | 'none';
  maskedKey?: string;
  updatedAt?: string;
  expiresAt?: string;
}

export interface MarkingApiKeyResult {
  ok: boolean;
  status?: MarkingApiKeyStatus;
  /** Same error vocabulary as MarkingCodeLookup.error. */
  error?: string;
}

/**
 * Collapse every failure mode into one small vocabulary the UI can translate:
 * NO_TOKEN, OFFLINE, TIMEOUT, FORBIDDEN, SESSION_EXPIRED, REGISTRY_KEY_MISSING,
 * REGISTRY_KEY_REJECTED, REGISTRY_UNREACHABLE, REGISTRY_BAD_RESPONSE, HTTP_<n>, REQUEST_FAILED.
 */
async function errorFromResponse(res: Response): Promise<string> {
  // The VPS exception filter keeps only `message`, so our server puts the code there.
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body?.message === 'string' && /^[A-Z][A-Z_]{3,}$/.test(body.message.trim())) {
      return body.message.trim();
    }
  } catch {
    // non-JSON body (nginx error page, gateway timeout) — fall through to the status
  }
  // 401 here is OUR JWT: the server maps a registry key rejection to REGISTRY_KEY_REJECTED.
  if (res.status === 401) return 'SESSION_EXPIRED';
  if (res.status === 403) return 'FORBIDDEN';
  return `HTTP_${res.status}`;
}

function errorFromException(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'TIMEOUT';
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(e.message)) return 'OFFLINE';
    return e.message;
  }
  return 'REQUEST_FAILED';
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
 * Full registry lookup for the Marking Check screen. Unlike verifyCirculation() — which only needs
 * a yes/no for the sale guard — this surfaces every field asl-belgisi returns (dates, package type,
 * issuer) plus a diagnosable failure reason, so staff can tell "code is bad" from "we couldn't ask".
 *
 * NOTE: this deliberately goes through the VPS proxy rather than calling xtrace directly. The POS
 * is packaged with `asar: false`, so an API key bundled into the app would be readable on every
 * terminal; the key stays on the server.
 */
export async function verifyMarkingCodeDetails(rawCode: string): Promise<MarkingCodeLookup> {
  const code = normalizeDataMatrix(rawCode);
  if (!code) return { reachable: false, error: 'EMPTY_CODE' };

  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return { reachable: false, lookupCode: stripCryptoTail(code), error: 'NO_TOKEN' };

  try {
    const res = await fetch(`${config.vpsApiUrl}/aslbelgisi/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // Send the full scan: the server applies stripCryptoTail() itself, and the raw form is what
      // the registry proxy logs for support.
      body: JSON.stringify({ code }),
      // Roomier than the 1.5s sale-path ceiling — a person is waiting on this result on purpose.
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      return {
        reachable: false,
        lookupCode: stripCryptoTail(code),
        error: await errorFromResponse(res),
      };
    }

    const details = (await res.json()) as MarkingCodeDetails;
    return { reachable: true, lookupCode: stripCryptoTail(code), details };
  } catch (e) {
    return {
      reachable: false,
      lookupCode: stripCryptoTail(code),
      error: errorFromException(e),
    };
  }
}

/** Read the server-side asl-belgisi key state (configured? which one? expiring when?). */
export async function getMarkingApiKeyStatus(): Promise<MarkingApiKeyResult> {
  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return { ok: false, error: 'NO_TOKEN' };
  try {
    const res = await fetch(`${config.vpsApiUrl}/aslbelgisi/api-key`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) };
    return { ok: true, status: (await res.json()) as MarkingApiKeyStatus };
  } catch (e) {
    return { ok: false, error: errorFromException(e) };
  }
}

/**
 * Rotate the registry key. The key is sent to the VPS and stored there, per store — never written
 * to the terminal, because the POS ships with `asar: false` and anything on disk is readable.
 * The server probes the key against xtrace before saving, so `ok: true` means it actually works.
 */
export async function setMarkingApiKey(key: string): Promise<MarkingApiKeyResult> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'EMPTY_KEY' };

  const config = getAppConfig();
  const token = getServerToken();
  if (!token) return { ok: false, error: 'NO_TOKEN' };
  try {
    const res = await fetch(`${config.vpsApiUrl}/aslbelgisi/api-key`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: trimmed }),
      // The server round-trips to xtrace to validate before saving.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, error: await errorFromResponse(res) };
    return { ok: true, status: (await res.json()) as MarkingApiKeyStatus };
  } catch (e) {
    return { ok: false, error: errorFromException(e) };
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
