import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * A database created by an older build must end up with every table the current build queries.
 *
 * `createSchemaIfNeeded` used to return early when `local_config` already existed, so a table
 * added to it later never reached a terminal whose database predated it. `audit_logs` shipped
 * exactly that way and killed the shift panel with "no such table: audit_logs" — on one store's
 * terminal only, which is the worst way to find out.
 *
 * `sqlite-schema.test.ts` could not catch it: that test walks the Prisma models, and `audit_logs`
 * is raw-SQL only. This one starts from a legacy database and asserts the real outcome instead.
 */

const dataDir = mkdtempSync(join(tmpdir(), 'posgro-legacy-'));

jest.mock('electron', () => ({
  app: { getPath: () => dataDir, getAppPath: () => join(__dirname, '..', '..', '..') },
}));

import { initializeDatabase, closeDatabase, getPrismaClient } from './sqlite-client';

/** Tables the app reads or writes by raw SQL, so no Prisma model declares them. */
const RAW_SQL_TABLES = ['audit_logs'];

async function tableNames(): Promise<string[]> {
  // getPrismaClient() is `any` — the client is resolved through a runtime require — so the row
  // type is asserted rather than inferred.
  const rows = (await getPrismaClient().$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table'",
  )) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

beforeAll(async () => {
  // A database from an older build: `local_config` exists, so the old guard would have declared
  // the schema complete and skipped everything else.
  const { PrismaClient } = require('../../generated/prisma-sqlite');
  const seed = new PrismaClient({
    datasources: { db: { url: `file:${join(dataDir, 'pos-local.db')}` } },
  });
  await seed.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS local_config (
      id TEXT PRIMARY KEY DEFAULT 'config',
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      terminal_id TEXT NOT NULL,
      api_url TEXT NOT NULL,
      last_sync DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await seed.$disconnect();

  await initializeDatabase();
}, 120_000);

afterAll(async () => {
  await closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('upgrading a database created by an older build', () => {
  it.each(RAW_SQL_TABLES)('creates the raw-SQL table %s', async (table) => {
    expect(await tableNames()).toContain(table);
  });

  it('creates the tables the Prisma models need', async () => {
    const names = await tableNames();
    for (const table of ['users', 'products', 'sales', 'sale_items', 'smenas', 'system_settings']) {
      expect(names).toContain(table);
    }
  });

  it('creates tables added by later migrations', async () => {
    const names = await tableNames();
    for (const table of ['inventory_counts', 'inventory_count_items', '_CategoryToSupplier']) {
      expect(names).toContain(table);
    }
  });

  // The failure the user actually hit: the shift panel's Z-report reads deleted sales from
  // audit_logs, and a missing table took down `smena:getCurrent` on every open.
  it('can query audit_logs the way the shift report does', async () => {
    const rows = await getPrismaClient().$queryRawUnsafe(
      `SELECT entity_id FROM audit_logs WHERE action = 'DELETE_SALE'`,
    );
    expect(Array.isArray(rows)).toBe(true);
  });

  it('leaves the existing local_config row untouched by a second boot', async () => {
    await getPrismaClient().localConfig.upsert({
      where: { id: 'config' },
      update: { storeName: 'Kept' },
      create: {
        id: 'config',
        storeId: 's',
        storeName: 'Kept',
        terminalId: 'T1',
        apiUrl: 'http://x',
      },
    });
    await closeDatabase();
    await initializeDatabase();
    const config = await getPrismaClient().localConfig.findUnique({ where: { id: 'config' } });
    expect(config?.storeName).toBe('Kept');
  }, 60_000);
});
