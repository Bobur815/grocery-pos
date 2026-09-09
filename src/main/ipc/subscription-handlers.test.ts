/**
 * `subscription:get`.
 *
 * Two things this must not do again: drop the store's identity on the floor (the server sends
 * `store_id`/`store_name` for this dialog and nothing was reading them), and collapse every
 * failure into one silent blank — offline, no credential and an expired token each need a
 * different action from whoever is standing at the terminal.
 */

jest.mock('electron', () => ({
  ipcMain: { handle: jest.fn() },
  shell: { openExternal: jest.fn() },
}));
jest.mock('../logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../config/app-config', () => ({
  getAppConfig: () => ({ vpsApiUrl: 'https://vps.example/api' }),
}));

let inMemoryToken: string | null = null;
jest.mock('../sync/queue-manager', () => ({ getServerToken: () => inMemoryToken }));

let localConfigMode: string | null = null;

const prismaMock = {
  localConfig: {
    findUnique: jest.fn(async () => ({ mode: localConfigMode })),
  },
  systemSetting: {
    findUnique: jest.fn<Promise<{ value: string } | null>, [{ where: { key: string } }]>(),
    upsert: jest.fn<Promise<void>, [{ update: { value: string } }]>(async () => undefined),
  },
};
jest.mock('../database/sqlite-client', () => ({ getPrismaClient: () => prismaMock }));

jest.mock('qrcode', () => ({ toDataURL: async () => 'data:image/png;base64,QR' }));

import { ipcMain } from 'electron';
import { setupSubscriptionHandlers } from './subscription-handlers';
import type { StoreSubscription } from '../../shared/types/store.types';

/** The registered `subscription:get` handler. */
function getHandler(): () => Promise<StoreSubscription> {
  setupSubscriptionHandlers();
  const call = (ipcMain.handle as jest.Mock).mock.calls.find(
    ([channel]) => channel === 'subscription:get',
  );
  if (!call) throw new Error('subscription:get was not registered');
  return call[1];
}

const SERVER_BODY = {
  store_id: 'store-1000',
  store_name: 'Продуктовый №7',
  subscription_plan: 'standard',
  subscription_expires_at: '2026-12-31T00:00:00.000Z',
  ai_plan: 'paid',
  balance_uzs: 250000,
  payment: {
    qr_payload: '00020101',
    payment_url: 'https://pay.example/store-1000',
    support_phone: '+998901234567',
  },
};

/** A cache row holding a previous successful read. */
function cachedRow() {
  return {
    value: JSON.stringify({
      storeId: 'store-1000',
      storeName: 'Продуктовый №7',
      plan: 'standard',
      expiresAt: '2026-12-31T00:00:00.000Z',
      aiPlan: 'paid',
      balanceUzs: 250000,
      qrDataUrl: 'data:image/png;base64,QR',
      paymentUrl: 'https://pay.example/store-1000',
      supportPhone: '+998901234567',
    }),
  };
}

/** Route the two systemSetting reads: the token row and the cache row. */
function settings({ token, cache }: { token?: string | null; cache?: { value: string } | null }) {
  prismaMock.systemSetting.findUnique.mockImplementation(async ({ where }) =>
    where.key === 'server_token'
      ? token
        ? { value: token }
        : null
      : (cache ?? null),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  inMemoryToken = null;
  localConfigMode = 'ONLINE';
  settings({ token: 'jwt-token', cache: null });
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => SERVER_BODY,
  })) as unknown as typeof fetch;
});

describe('a successful read', () => {
  it('carries the store identity through — the bug this was reported for', () => {
    return getHandler()().then((result) => {
      expect(result.storeId).toBe('store-1000');
      expect(result.storeName).toBe('Продуктовый №7');
    });
  });

  it('returns the plan, balance and payment details', async () => {
    const result = await getHandler()();

    expect(result).toMatchObject({
      plan: 'standard',
      aiPlan: 'paid',
      balanceUzs: 250000,
      stale: false,
    });
    expect(result.payment.paymentUrl).toBe('https://pay.example/store-1000');
    expect(result.payment.qrDataUrl).toBe('data:image/png;base64,QR');
  });

  it('carries no failure reason', async () => {
    expect((await getHandler()()).reason).toBeUndefined();
  });

  it('caches the identity too, so an offline reopen still names the store', async () => {
    await getHandler()();

    const written = JSON.parse(prismaMock.systemSetting.upsert.mock.calls[0][0].update.value);
    expect(written).toMatchObject({ storeId: 'store-1000', storeName: 'Продуктовый №7' });
  });

  it('sends the persisted token when no login has armed one this session', async () => {
    await getHandler()();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
  });
});

describe('failures are named, not swallowed', () => {
  it('says no-credential when the terminal has never had a password login', async () => {
    settings({ token: null, cache: null });

    const result = await getHandler()();

    expect(result.reason).toBe('no-credential');
    expect(result.stale).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('names an OFFLINE_ONLY store separately — its advice is different', async () => {
    // The vendor's server refuses /auth/login for such a store (403 store_offline_only), so it can
    // never hold a credential. Telling this shop to "sign in with a password" is advice nobody
    // there can act on; the dialog has to point at the vendor instead.
    settings({ token: null, cache: null });
    localConfigMode = 'OFFLINE_ONLY';

    expect((await getHandler()()).reason).toBe('offline-only-store');
  });

  it('still says no-credential for an ONLINE store with no token', async () => {
    settings({ token: null, cache: null });
    localConfigMode = 'ONLINE';

    expect((await getHandler()()).reason).toBe('no-credential');
  });

  it('falls back to no-credential when the mode is unknown', async () => {
    // A never-activated terminal reads null here; the generic advice is the safe one.
    settings({ token: null, cache: null });
    localConfigMode = null;

    expect((await getHandler()()).reason).toBe('no-credential');
  });

  it('says unreachable when the request itself fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('fetch failed');
    }) as unknown as typeof fetch;

    expect((await getHandler()()).reason).toBe('unreachable');
  });

  it('says server-error when it answered with a status — an expired token, say', async () => {
    // The distinction matters: the network is fine, so "check your connection" would send the
    // shop chasing the wrong thing. 401 means sign in again.
    global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as
      unknown as typeof fetch;

    expect((await getHandler()()).reason).toBe('server-error');
  });

  it('still shows the last known store and plan from cache', async () => {
    settings({ token: 'jwt-token', cache: cachedRow() });
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const result = await getHandler()();

    expect(result.storeName).toBe('Продуктовый №7');
    expect(result.plan).toBe('standard');
    expect(result.stale).toBe(true);
  });

  it('returns empty rather than throwing on a terminal that never reached the server', async () => {
    settings({ token: null, cache: null });

    const result = await getHandler()();

    expect(result.storeName).toBeNull();
    expect(result.plan).toBeNull();
    expect(result.aiPlan).toBe('free');
  });

  it('survives a corrupted cache row', async () => {
    settings({ token: null, cache: { value: 'not json' } });

    await expect(getHandler()()).resolves.toMatchObject({ storeName: null, stale: true });
  });
});
