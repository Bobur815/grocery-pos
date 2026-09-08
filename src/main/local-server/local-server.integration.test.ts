import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * End-to-end: a real SQLite database, the real HTTP server, real requests.
 *
 * The unit tests either side of this cover routing and the stocktake arithmetic in isolation.
 * What they cannot show is that the queries actually run — that every column a route selects
 * exists in a database built by `createSchemaIfNeeded`, that the write paths commit, and that a
 * request survives the whole way through auth and the router. A route can typecheck perfectly
 * and still fail on the first real query, which is exactly how a missing local column has shipped
 * here before (see the note on migration 27 in sqlite-client.ts).
 *
 * Electron is stubbed: the only things the modules under test want from it are two paths.
 */

const dataDir = mkdtempSync(join(tmpdir(), 'posgro-local-server-'));

jest.mock('electron', () => ({
  app: {
    getPath: () => dataDir,
    // The repo root, so the static handler resolves dist-web the way the packaged app does.
    getAppPath: () => join(__dirname, '..', '..', '..'),
  },
}));

import { initializeDatabase, closeDatabase, getPrismaClient } from '../database/sqlite-client';
import { startLocalServer, stopLocalServer, getLocalServerStatus } from './index';

const PORT = 5399;
let token = '';

/** Call the API the way the dashboard does. */
async function api(
  method: string,
  path: string,
  body?: unknown,
  auth = true,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  process.env.JWT_SECRET = 'integration-test-secret-key-32-chars';
  await initializeDatabase();

  const prisma = getPrismaClient();
  await prisma.systemSetting.upsert({
    where: { key: 'local_web_port' },
    update: { value: String(PORT) },
    create: { key: 'local_web_port', value: String(PORT) },
  });
  await prisma.localConfig.upsert({
    where: { id: 'config' },
    update: { mode: 'OFFLINE_ONLY' },
    create: {
      id: 'config',
      storeId: 'store-test',
      storeName: 'Test Shop',
      terminalId: 'T1',
      apiUrl: 'http://localhost',
      mode: 'OFFLINE_ONLY',
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bcrypt = require('bcryptjs');
  await prisma.user.create({
    data: {
      id: 'user-admin',
      phone: '+998900000001',
      password: await bcrypt.hash('secret123', 10),
      role: 'ADMIN',
      nameRu: 'Админ',
      nameUz: 'Admin',
      active: true,
      storeId: 'store-test',
    },
  });

  const category = await prisma.category.create({
    data: { nameRu: 'Напитки', nameUz: 'Ichimliklar' },
  });
  await prisma.product.create({
    data: {
      barcode: '4780000000001',
      nameRu: 'Вода 1л',
      nameUz: 'Suv 1l',
      price: 5000,
      cost: 3000,
      stock: 12,
      minStock: 20,
      unit: 'шт',
      categoryId: category.id,
      mxik: '01234567890123456',
    },
  });

  await startLocalServer();
}, 120_000);

afterAll(async () => {
  await stopLocalServer();
  await closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('the server itself', () => {
  it('is listening on the configured port', () => {
    expect(getLocalServerStatus()).toMatchObject({ running: true, port: PORT });
  });

  // Only meaningful once `npm run build:web` has staged the dashboard, which a fresh checkout has
  // not — so this is skipped rather than failed there, and runs for real in a release build.
  const built = existsSync(join(__dirname, '..', '..', '..', 'dist-web', 'index.html'));
  (built ? describe : describe.skip)('with the dashboard built', () => {
    it('serves the real index.html and the asset it references', async () => {
      const page = await fetch(`http://127.0.0.1:${PORT}/web/`);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain('<div id="root">');

      const asset = /src="(\/web\/assets\/[^"]+\.js)"/.exec(html)?.[1];
      expect(asset).toBeTruthy();
      const js = await fetch(`http://127.0.0.1:${PORT}${asset}`);
      expect(js.status).toBe(200);
      expect(js.headers.get('content-type')).toContain('javascript');
    });

    it('returns the app shell for a deep link', async () => {
      const res = await fetch(`http://127.0.0.1:${PORT}/web/reports/analytics`);
      expect(await res.text()).toContain('<div id="root">');
    });
  });

  it('sends the root to the dashboard', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/web/');
  });

  it('404s an unknown API path', async () => {
    expect((await api('GET', '/nope')).status).toBe(404);
  });

  it('405s a known path under the wrong method', async () => {
    expect((await api('DELETE', '/categories')).status).toBe(405);
  });
});

describe('auth', () => {
  it('refuses a request with no token', async () => {
    expect((await api('GET', '/products', undefined, false)).status).toBe(401);
  });

  it('refuses the wrong password without saying which half was wrong', async () => {
    const res = await api('POST', '/auth/login', { phone: '+998900000001', password: 'nope' }, false);
    expect(res.status).toBe(401);
    expect(res.json.message).toBe('Invalid phone or password');
  });

  it('refuses an unknown phone with the same message', async () => {
    const res = await api('POST', '/auth/login', { phone: '+998900009999', password: 'nope' }, false);
    expect(res.json.message).toBe('Invalid phone or password');
  });

  it('issues a token and never returns the password hash', async () => {
    const res = await api(
      'POST',
      '/auth/login',
      { phone: '+998900000001', password: 'secret123' },
      false,
    );
    expect(res.status).toBe(201);
    expect(typeof res.json.token).toBe('string');
    expect(res.json.user).toMatchObject({ phone: '+998900000001', role: 'ADMIN' });
    expect(res.json.user).not.toHaveProperty('password');
    token = res.json.token;
  });

  it('accepts the token on a guarded route', async () => {
    expect((await api('GET', '/auth/profile')).status).toBe(200);
  });

  it('rejects a token this server did not sign', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/products`, {
      headers: { Authorization: 'Bearer not.a.real.token' },
    });
    expect(res.status).toBe(401);
  });
});

describe('products', () => {
  it('lists with the category joined', async () => {
    const { status, json } = await api('GET', '/products');
    expect(status).toBe(200);
    expect(json).toHaveLength(1);
    expect(json[0].category.nameRu).toBe('Напитки');
  });

  // The dashboard was written against the server's raw Prisma rows: `active`, not the POS
  // renderer's `isActive`, and Decimals as strings.
  it('uses the server wire format, not the POS renderer format', async () => {
    const { json } = await api('GET', '/products');
    expect(json[0]).toHaveProperty('active', true);
    expect(json[0]).not.toHaveProperty('isActive');
    expect(typeof json[0].price).toBe('string');
    expect(json[0].price).toBe('5000');
  });

  it('finds one by barcode', async () => {
    const { json } = await api('GET', '/products/barcode/4780000000001');
    expect(json.nameRu).toBe('Вода 1л');
  });

  it('404s an unknown barcode', async () => {
    expect((await api('GET', '/products/barcode/0000000000000')).status).toBe(404);
  });

  it('filters by search term', async () => {
    expect((await api('GET', '/products?query=Вода')).json).toHaveLength(1);
    expect((await api('GET', '/products?query=Хлеб')).json).toHaveLength(0);
  });

  it('creates, updates and reads back', async () => {
    const created = await api('POST', '/products', {
      barcode: '4780000000002',
      nameRu: 'Хлеб',
      nameUz: 'Non',
      price: 4000,
      stock: 5,
      categoryId: (await api('GET', '/categories')).json[0].id,
      mxik: '01234567890123456',
    });
    expect(created.status).toBe(201);

    const updated = await api('PATCH', `/products/${created.json.id}`, { price: 4500 });
    expect(updated.json.price).toBe('4500');

    const fetched = await api('GET', `/products/${created.json.id}?byDbId=true`);
    expect(fetched.json.nameRu).toBe('Хлеб');
  });

  it('refuses a product with no MXIK, which could not be fiscalised', async () => {
    const res = await api('POST', '/products', {
      barcode: '4780000000003',
      nameRu: 'X',
      nameUz: 'X',
      categoryId: 1,
    });
    expect(res.status).toBe(400);
  });

  it('reports low stock', async () => {
    const { json } = await api('GET', '/inventory/low-stock');
    // Stock 12 against a minimum of 20.
    expect(json.map((p: any) => p.barcode)).toContain('4780000000001');
  });

  it('serves next-internal-code without treating it as a product id', async () => {
    const { status, json } = await api('GET', '/products/next-internal-code');
    expect(status).toBe(200);
    expect(json).toBe('10000');
  });
});

describe('settings', () => {
  it('round-trips a value', async () => {
    await api('PUT', '/settings/receipt_header', { value: 'Test Shop' });
    expect((await api('GET', '/settings/receipt_header')).json).toEqual({
      key: 'receipt_header',
      value: 'Test Shop',
    });
  });

  it('returns a null value for an unset key rather than 404', async () => {
    expect((await api('GET', '/settings/never_set')).json).toEqual({
      key: 'never_set',
      value: null,
    });
  });

  it('returns every setting as one map', async () => {
    expect((await api('GET', '/settings')).json).toMatchObject({ receipt_header: 'Test Shop' });
  });
});

describe('suppliers', () => {
  let supplierId = '';

  it('creates one with categories attached', async () => {
    const categoryId = (await api('GET', '/categories')).json[0].id;
    const res = await api('POST', '/suppliers', {
      nameRu: 'Поставщик',
      nameUz: 'Yetkazuvchi',
      categoryIds: [categoryId],
    });
    expect(res.status).toBe(201);
    expect(res.json.categories).toHaveLength(1);
    supplierId = res.json.id;
  });

  // `/suppliers/transactions` must not be read as a supplier whose id is "transactions".
  it('serves the transactions list, not a supplier lookup', async () => {
    const { status, json } = await api('GET', '/suppliers/transactions');
    expect(status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
  });

  it('moves the balance when a payment is recorded', async () => {
    await api('POST', '/suppliers/payments', { supplierId, amount: 50000 });
    expect((await api('GET', `/suppliers/${supplierId}/balance`)).json.balance).toBe('50000');
  });

  it('reverses the balance when the transaction is deleted', async () => {
    const tx = (await api('GET', `/suppliers/transactions?supplierId=${supplierId}`)).json[0];
    await api('DELETE', `/suppliers/transactions/${tx.id}`);
    expect((await api('GET', `/suppliers/${supplierId}/balance`)).json.balance).toBe('0');
  });
});

describe('stocktake', () => {
  let countId = '';

  it('opens a document over every active product', async () => {
    const res = await api('POST', '/inventory-counts', { note: 'Monthly' });
    expect(res.status).toBe(201);
    expect(res.json.totalItems).toBeGreaterThan(0);
    countId = res.json.id;
  });

  it('refuses a second open document', async () => {
    const res = await api('POST', '/inventory-counts', {});
    expect(res.status).toBe(400);
  });

  it('counts a line by scanning its barcode', async () => {
    const res = await api('POST', `/inventory-counts/${countId}/scan`, {
      barcode: '4780000000001',
      qty: 9,
    });
    expect(res.status).toBe(201);
    expect(res.json.item.countedQty).toBe('9');
    expect(res.json.status).toBe('IN_PROGRESS');
  });

  it('accumulates repeated scans of the same line', async () => {
    const res = await api('POST', `/inventory-counts/${countId}/scan`, {
      barcode: '4780000000001',
      qty: 1,
    });
    expect(res.json.item.countedQty).toBe('10');
  });

  it('rejects a barcode outside the document', async () => {
    const res = await api('POST', `/inventory-counts/${countId}/scan`, { barcode: '999' });
    expect(res.status).toBe(404);
  });

  it('writes the counted figure back to product stock on completion', async () => {
    const res = await api('POST', `/inventory-counts/${countId}/complete`, {});
    expect(res.status).toBe(201);
    expect(res.json.status).toBe('COMPLETED');

    const product = (await api('GET', '/products/barcode/4780000000001')).json;
    // Counted 10 against an expected 12.
    expect(product.stock).toBe('10');
    expect(product.stockCountedAt).not.toBeNull();
  });

  it('lists the completed document with its totals', async () => {
    const { json } = await api('GET', '/inventory-counts');
    expect(json.total).toBe(1);
    expect(json.rows[0]).toMatchObject({ status: 'COMPLETED', countedItems: 1 });
    expect(json.rows[0].totalDifference).toBe('-2');
  });

  it('refuses to complete a document where nothing was counted', async () => {
    const created = await api('POST', '/inventory-counts', {});
    const res = await api('POST', `/inventory-counts/${created.json.id}/complete`, {
      writeOffUncounted: true,
    });
    expect(res.status).toBe(400);
    expect(res.json.message).toBe('Nothing counted yet');
    await api('POST', `/inventory-counts/${created.json.id}/cancel`);
  });
});

describe('reports', () => {
  it('serves analytics with every section the dashboard reads', async () => {
    const { status, json } = await api(
      'GET',
      '/analytics/data?startDate=2020-01-01&endDate=2030-01-01',
    );
    expect(status).toBe(200);
    expect(Object.keys(json).sort()).toEqual([
      'cashierPerformance',
      'hourlyDistribution',
      'productRanking',
      'profitMargins',
      'salesByCategory',
      'salesTrend',
      'summary',
      'topProducts',
    ]);
    // The section the POS's own analytics handler omits entirely.
    expect(json.productRanking).toHaveProperty('byProfit');
    expect(json.productRanking.totalProducts).toBeGreaterThan(0);
  });

  it('reconciles money with no shifts, and says it compared nothing', async () => {
    const { status, json } = await api('GET', '/reconciliation/money?from=2020-01-01&to=2030-01-01');
    expect(status).toBe(200);
    expect(json.limitation).toBe('NO_SHIFT_DATA_ON_SERVER');
    expect(json.cashVariance).toBeNull();
  });

  it('reports the goods ledger as unavailable rather than inventing variances', async () => {
    const { json } = await api('GET', '/reconciliation/goods');
    expect(json.ledgerEnabled).toBe(false);
    expect(json.lines).toEqual([]);
    expect(json.crossCheck.clean).toBe(true);
  });
});

describe('endpoints that need the online server', () => {
  it('says so for invoice scanning instead of failing obscurely', async () => {
    const res = await api('POST', '/invoice/scan', { imageBase64: 'x', mimeType: 'image/png' });
    expect(res.status).toBe(503);
    expect(res.json.message).toMatch(/online server/i);
  });

  it('still matches invoice lines locally, which needs no AI', async () => {
    const res = await api('POST', '/invoice/match-products', { items: [{ name: 'Вода 1л' }] });
    expect(res.status).toBe(201);
    expect(res.json[0]).toMatchObject({ confidence: 'exact', matchedProductNameRu: 'Вода 1л' });
  });

  it('synthesises the store record from local config', async () => {
    const { json } = await api('GET', '/stores/store-test');
    expect(json).toMatchObject({ id: 'store-test', name: 'Test Shop', mode: 'OFFLINE_ONLY' });
  });

  it('serves store-config the way the terminal itself would', async () => {
    const { json } = await api('GET', '/store-config');
    expect(json).toMatchObject({ mode: 'OFFLINE_ONLY', pos_admin_locked: false });
  });
});
