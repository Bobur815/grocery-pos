import { stripCryptoTail } from '../../../shared/utils/marking';
import { db, required } from '../helpers';
import { badRequest, notFound, unavailable, type Route } from '../router';

/**
 * The endpoints that have no straightforward local equivalent.
 *
 * Three different situations, each answered differently rather than all lumped into a 404:
 *
 *  - **Synthesised** — store identity, which the terminal knows from `local_config` even though
 *    it has no `Store` row.
 *  - **Genuinely local** — invoice line matching, marking-code lookup, the MXIK proxy: these
 *    never needed the store's database, only string comparison or the internet.
 *  - **Not possible offline** — AI invoice scanning, the national goods catalogue, billing state.
 *    These return 503 with a reason the dashboard can show, not a silent empty result, because a
 *    blank screen reads as "you have no products" rather than "this needs the server".
 */

const ADMIN_ONLY = ['ADMIN', 'SUPER_ADMIN'];

/** Build the closest thing to the server's Store row out of what the terminal actually knows. */
async function localStore() {
  const config = await db().localConfig.findUnique({ where: { id: 'config' } });
  if (!config) throw notFound('Store not configured');
  return {
    id: config.storeId,
    name: config.storeName,
    // Everything below lives only in the VPS's Store row — address, billing, subscription. Null
    // rather than invented: the dashboard renders an empty field, which is the truth here.
    address: null,
    phone: null,
    active: true,
    aiPlan: 'free',
    balance: 0,
    subscriptionPlan: null,
    subscriptionExpiresAt: null,
    scheduledDeleteAt: null,
    mode: config.mode ?? 'ONLINE',
    posAdminLocked: config.posAdminLocked,
    createdAt: config.lastSync.toISOString(),
    updatedAt: config.lastSync.toISOString(),
  };
}

export const storeRoutes: Route[] = [
  {
    method: 'GET',
    path: '/stores',
    handler: async () => [await localStore()],
  },

  {
    method: 'GET',
    path: '/stores/:id/stats',
    handler: async () => {
      const [store, usersCount, productsCount, sales] = await Promise.all([
        localStore(),
        db().user.count(),
        db().product.count(),
        db().sale.findMany({ select: { finalAmount: true } }),
      ]);
      return {
        store,
        stats: {
          totalRevenue: sales.reduce((sum, s) => sum + Number(s.finalAmount), 0),
          totalSales: sales.length,
          productsCount,
          usersCount,
        },
      };
    },
  },

  {
    method: 'GET',
    path: '/stores/:id',
    handler: () => localStore(),
  },

  {
    method: 'GET',
    path: '/store-config',
    handler: async () => {
      const config = await db().localConfig.findUnique({ where: { id: 'config' } });
      return {
        // The free-tier allowance. AI scanning needs the VPS anyway, so the number is academic.
        ai_token_limit_daily: 5,
        mode: config?.mode ?? 'ONLINE',
        pos_admin_locked: config?.posAdminLocked ?? false,
      };
    },
  },
];

/**
 * Site config.
 *
 * On the VPS these are operator-wide values shared by every store. A terminal has no such scope,
 * so they are kept in its own settings table — which means an OFFLINE_ONLY shop can set its own
 * login banner, and gets empty defaults rather than an error if it never has.
 */
const SITE_KEYS = {
  banner: 'site_login_banner',
  plans: 'site_subscription_plans',
  payment: 'site_subscription_payment',
} as const;

async function readJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db().systemSetting.findUnique({ where: { key } });
  if (!row?.value) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.value) as Partial<T>) };
  } catch {
    return fallback;
  }
}

async function writeJsonSetting(key: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  await db().systemSetting.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized },
  });
}

export const siteConfigRoutes: Route[] = [
  {
    method: 'GET',
    path: '/site-config/login-banner',
    public: true,
    handler: () => readJsonSetting(SITE_KEYS.banner, { imageUrl: '', title: '', subtitle: '' }),
  },
  {
    method: 'PUT',
    path: '/site-config/login-banner',
    roles: ADMIN_ONLY,
    handler: async ({ body }) => {
      const banner = {
        imageUrl: String(body?.imageUrl ?? ''),
        title: String(body?.title ?? ''),
        subtitle: String(body?.subtitle ?? ''),
      };
      await writeJsonSetting(SITE_KEYS.banner, banner);
      return banner;
    },
  },
  {
    method: 'GET',
    path: '/site-config/subscription-plans',
    public: true,
    handler: () => readJsonSetting(SITE_KEYS.plans, { starter: 0, pro: 0, vip: 0 }),
  },
  {
    method: 'GET',
    path: '/site-config/subscription-payment',
    public: true,
    handler: () =>
      readJsonSetting(SITE_KEYS.payment, { qrPayload: '', paymentUrl: '', supportPhone: '' }),
  },
  {
    method: 'POST',
    path: '/site-config/upload-image',
    roles: ADMIN_ONLY,
    handler: () => {
      // Uploads go to the VPS's uploads directory, which a terminal does not serve.
      throw unavailable('Image upload needs the online server');
    },
  },
];

export const invoiceRoutes: Route[] = [
  {
    method: 'GET',
    path: '/invoice/plan',
    handler: () => ({ plan: 'free', balance_uzs: null }),
  },

  {
    method: 'POST',
    path: '/invoice/scan',
    roles: ADMIN_ONLY,
    handler: () => {
      throw unavailable(
        'Scanning an invoice needs the online server — it runs the recognition service.',
      );
    },
  },

  {
    method: 'POST',
    path: '/invoice/match-products',
    roles: ADMIN_ONLY,
    handler: async ({ body }) => {
      const items: Array<{ name?: string }> = Array.isArray(body?.items) ? body.items : [];
      const products = await db().product.findMany({
        where: { active: true },
        select: { id: true, nameRu: true, nameUz: true },
      });

      return items.map((item) => {
        const name = String(item?.name ?? '').trim().toLowerCase();
        const exact = products.find(
          (p) => p.nameRu.toLowerCase() === name || p.nameUz.toLowerCase() === name,
        );
        // Substring matching needs at least four characters — below that almost anything hits,
        // and a wrong match silently books a delivery against the wrong product.
        const partial =
          !exact && name.length >= 4
            ? products.find(
                (p) =>
                  p.nameRu.toLowerCase().includes(name) ||
                  p.nameUz.toLowerCase().includes(name) ||
                  name.includes(p.nameRu.toLowerCase()) ||
                  name.includes(p.nameUz.toLowerCase()),
              )
            : undefined;

        const match = exact ?? partial;
        return {
          scannedName: item?.name ?? '',
          matchedProductId: match ? String(match.id) : null,
          matchedProductNameRu: match?.nameRu ?? null,
          matchedProductNameUz: match?.nameUz ?? null,
          confidence: exact ? 'exact' : partial ? 'medium' : 'none',
        };
      });
    },
  },
];

const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';

export const mxikRoutes: Route[] = [
  {
    method: 'GET',
    path: '/mxik/code/:code',
    handler: async ({ params }) => {
      if (!/^\d{17}$/.test(params.code)) throw badRequest('MXIK code must be 17 digits');
      // A pass-through to the national classifier, exactly as the VPS does it. Needs the
      // internet but not the server — and the dashboard already calls tasnif directly for its
      // other lookups, so a terminal with a connection can serve this one too.
      try {
        const res = await fetch(`${TASNIF}/integration-mxik/get/history/${params.code}`, {
          signal: AbortSignal.timeout(8000),
        });
        const json = (await res.json()) as any;
        if (!json?.success || !json.data) throw notFound('MXIK code not found');
        const d = json.data;
        const brand = d.brandName ? `${d.brandName} ` : '';
        return {
          code: d.mxikCode,
          name: brand + (d.attributeNameUz ?? d.subPositionNameUz),
          nameRu: brand + (d.attributeNameRu ?? d.subPositionNameRu),
          packageCode: '796',
          isMarked: null,
        };
      } catch (err) {
        if (err && typeof err === 'object' && 'status' in err) throw err;
        throw unavailable('The MXIK catalogue is unreachable — check the internet connection.');
      }
    },
  },

  {
    // The national goods catalogue is a large reference table that lives only in the VPS
    // database. An empty list keeps the dashboard's group filter rendering; its barcode lookups
    // go straight to tasnif from the browser and are unaffected.
    method: 'GET',
    path: '/mxik/catalog/groups',
    handler: () => [],
  },
  {
    method: 'GET',
    path: '/mxik/catalog/lookup',
    handler: () => null,
  },
];

export const markingRoutes: Route[] = [
  {
    method: 'POST',
    path: '/aslbelgisi/verify',
    handler: async ({ body }) => {
      const code = String(required(body?.code, 'code'));
      const setting = await db().systemSetting.findUnique({
        where: { key: 'aslbelgisi_api_key' },
      });
      const key = setting?.value || process.env.ASLBELGISI_API_KEY;
      // These literals are matched by the dashboard to choose its message — keep them verbatim.
      if (!key) throw unavailable('REGISTRY_KEY_MISSING');

      // The registry keys on the identifier alone; leaving the crypto tail on returns no match.
      const stripped = stripCryptoTail(code);

      let res: Response;
      try {
        res = await fetch('https://xtrace.aslbelgisi.uz/public/api/cod/public/codes', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([stripped]),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw unavailable('REGISTRY_UNREACHABLE');
      }
      if (res.status === 401 || res.status === 403) throw unavailable('REGISTRY_KEY_REJECTED');

      let json: any;
      try {
        json = await res.json();
      } catch {
        throw unavailable('REGISTRY_BAD_RESPONSE');
      }

      const match = Array.isArray(json) ? json[0] : json?.[0];
      if (!match) return { isValid: false };
      return {
        isValid: true,
        status: match.status,
        extendedStatus: match.extendedStatus,
        gtin: match.gtin,
        productId: match.productId,
        productionDate: match.productionDate,
        expirationDate: match.expirationDate,
        productSeries: match.productSeries,
        packageType: match.packageType,
        issuerName: match.issuerName,
      };
    },
  },
];

export const logRoutes: Route[] = [
  // Terminal logs are uploaded to the VPS and read back there; a terminal keeps no queryable
  // copy. Empty results keep the super-admin page from erroring if it is ever opened.
  { method: 'GET', path: '/logs/meta', handler: () => ({ stores: [], terminalsByStore: {} }) },
  {
    method: 'GET',
    path: '/logs',
    handler: () => ({ items: [], total: 0, page: 1, limit: 50, pages: 0 }),
  },
];
