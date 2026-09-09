import { ipcMain, shell } from 'electron';
import QRCode from 'qrcode';
import { getAppConfig } from '../config/app-config';
import { getServerToken } from '../sync/queue-manager';
import { getPrismaClient } from '../database/sqlite-client';
import { log } from '../logger';
import type {
  StoreSubscription,
  SubscriptionFailureReason,
} from '../../shared/types/store.types';

/**
 * Subscription status for the login screen.
 *
 * The login screen is unauthenticated, so this reuses the VPS token the terminal keeps from the
 * last password login — the same credential `receipt:getPlan` and the sync loop use. Every reply
 * is cached in SQLite so the dialog still shows the last known plan and balance when the VPS is
 * unreachable, which is the normal state for an offline-first terminal.
 */

const CACHE_KEY = 'store_subscription';
const REQUEST_TIMEOUT_MS = 8000;

/** Shape of GET /store-config/subscription. */
interface SubscriptionResponse {
  store_id: string | null;
  store_name: string | null;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  ai_plan: string;
  balance_uzs: number | null;
  payment: {
    qr_payload: string;
    payment_url: string;
    support_phone: string;
  };
}

/** What gets cached — the QR is stored already rendered so an offline open costs nothing. */
interface CachedSubscription {
  storeId: string | null;
  storeName: string | null;
  plan: string | null;
  expiresAt: string | null;
  aiPlan: string;
  balanceUzs: number | null;
  qrDataUrl: string | null;
  paymentUrl: string;
  supportPhone: string;
}

/**
 * The token to read with. `getServerToken()` is only armed by a login, and this dialog opens
 * before one, so on a cold start fall back to the persisted row. This is a read of the store's
 * own billing state, so it deliberately does not re-arm the global token from here.
 */
async function readServerToken(prisma: ReturnType<typeof getPrismaClient>): Promise<string | null> {
  const inMemory = getServerToken();
  if (inMemory) return inMemory;
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'server_token' } });
  return setting?.value ?? null;
}

async function renderQr(payload: string): Promise<string | null> {
  if (!payload.trim()) return null;
  try {
    return await QRCode.toDataURL(payload, { width: 320, margin: 1 });
  } catch {
    return null;
  }
}

function toResult(
  cached: CachedSubscription,
  stale: boolean,
  reason?: SubscriptionFailureReason,
): StoreSubscription {
  return {
    storeId: cached.storeId,
    storeName: cached.storeName,
    plan: cached.plan,
    expiresAt: cached.expiresAt,
    aiPlan: cached.aiPlan,
    balanceUzs: cached.balanceUzs,
    payment: {
      qrDataUrl: cached.qrDataUrl,
      paymentUrl: cached.paymentUrl,
      supportPhone: cached.supportPhone,
    },
    stale,
    ...(reason ? { reason } : {}),
  };
}

const EMPTY: CachedSubscription = {
  storeId: null,
  storeName: null,
  plan: null,
  expiresAt: null,
  aiPlan: 'free',
  balanceUzs: null,
  qrDataUrl: null,
  paymentUrl: '',
  supportPhone: '',
};

async function readCache(prisma: ReturnType<typeof getPrismaClient>): Promise<CachedSubscription> {
  const row = await prisma.systemSetting.findUnique({ where: { key: CACHE_KEY } });
  if (!row?.value) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(row.value) as Partial<CachedSubscription>) };
  } catch {
    return EMPTY;
  }
}

export function setupSubscriptionHandlers(): void {
  ipcMain.handle('subscription:get', async (): Promise<StoreSubscription> => {
    const prisma = getPrismaClient();
    const config = getAppConfig();

    // Set as each failure mode is ruled out, so the renderer can say what to do about a blank
    // dialog instead of showing dashes with no explanation.
    let reason: SubscriptionFailureReason = 'unreachable';
    try {
      const token = await readServerToken(prisma);
      if (!token) {
        // An OFFLINE_ONLY store cannot get one. The server refuses /auth/login for such a store
        // (403 auth.errors.store_offline_only), so the setup token is the only one it ever holds
        // and nothing can replace it once it expires and is dropped. Telling this shop to "sign in
        // with a password" would be advice they cannot follow, so name the real situation.
        const localConfig = await prisma.localConfig
          .findUnique({ where: { id: 'config' } })
          .catch(() => null);
        reason = localConfig?.mode === 'OFFLINE_ONLY' ? 'offline-only-store' : 'no-credential';
        throw new Error('NO_SERVER_TOKEN');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${config.vpsApiUrl}/store-config/subscription`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${token}` },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        // It answered, so the network is fine — an expired token (401) or an older server.
        reason = 'server-error';
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as SubscriptionResponse;
      const fresh: CachedSubscription = {
        storeId: data.store_id ?? null,
        storeName: data.store_name ?? null,
        plan: data.subscription_plan ?? null,
        expiresAt: data.subscription_expires_at ?? null,
        aiPlan: data.ai_plan ?? 'free',
        balanceUzs: typeof data.balance_uzs === 'number' ? data.balance_uzs : null,
        qrDataUrl: await renderQr(data.payment?.qr_payload ?? ''),
        paymentUrl: data.payment?.payment_url ?? '',
        supportPhone: data.payment?.support_phone ?? '',
      };

      const value = JSON.stringify(fresh);
      await prisma.systemSetting.upsert({
        where: { key: CACHE_KEY },
        update: { value },
        create: { key: CACHE_KEY, value },
      });

      return toResult(fresh, false);
    } catch (e) {
      // Offline, no credential, or an older server without the endpoint — show what we last saw,
      // and say which it was. Logged too: this is uploaded, so a store reporting an empty dialog
      // can be diagnosed without a remote session. An OFFLINE_ONLY store is the expected steady
      // state rather than a fault, so it logs at info — a warning per button press would be noise.
      const line = `[subscription] live read failed (${reason}): ${e instanceof Error ? e.message : e}`;
      if (reason === 'offline-only-store') log.info(line);
      else log.warn(line);
      return toResult(await readCache(prisma), true, reason);
    }
  });

  /**
   * Open the self-service payment link in the customer's own browser. The URL comes from the
   * server, so it is re-checked here: the POS must never be talked into launching a local file
   * or a custom protocol handler.
   */
  ipcMain.handle('subscription:openPaymentLink', async (_event, url: string): Promise<boolean> => {
    if (!/^https?:\/\/.+/i.test(url ?? '')) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });
}
