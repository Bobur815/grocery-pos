// Use the SQLite-specific Prisma client
import path from 'path';
import { app } from 'electron';
import fs from 'fs';

// Resolve prisma client path relative to app root.
// In production the JS files live inside app.asar; the .node binary is unpacked to
// app.asar.unpacked/ via asarUnpack and Electron redirects require() transparently.
const prismaClientPath = path.join(app.getAppPath(), 'src', 'generated', 'prisma-sqlite');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require(prismaClientPath);

type PrismaClientType = InstanceType<typeof PrismaClient>;

let prisma: PrismaClientType | null = null;

export function getPrismaClient(): PrismaClientType {
  if (!prisma) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return prisma;
}

const BOOTSTRAP_FILE = 'store-bootstrap.json';

export function getUserDataPath(): string {
  return app.getPath('userData');
}

export function readStoreBootstrap(): string | null {
  try {
    const raw = fs.readFileSync(path.join(getUserDataPath(), BOOTSTRAP_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as { storeId?: string };
    return parsed.storeId || null;
  } catch {
    return null;
  }
}

export function writeStoreBootstrap(storeId: string): void {
  fs.writeFileSync(
    path.join(getUserDataPath(), BOOTSTRAP_FILE),
    JSON.stringify({ storeId }),
    'utf-8',
  );
}

export async function initializeDatabase(): Promise<void> {
  // Get the user data path for the database file
  const userDataPath = app.getPath('userData');

  // Determine which DB file to use based on the bootstrap config.
  // Each store gets its own isolated SQLite file (pos-{storeId}.db).
  // Falls back to pos-local.db for existing installs without a bootstrap file.
  const bootstrapStoreId = readStoreBootstrap();
  const dbFileName = bootstrapStoreId ? `pos-${bootstrapStoreId}.db` : 'pos-local.db';
  const dbPath = path.join(userDataPath, dbFileName);

  console.log(`[db] Opening database: ${dbFileName} (storeId=${bootstrapStoreId ?? 'unset'})`);

  // Ensure directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Set environment variable for Prisma
  process.env.DATABASE_URL = `file:${dbPath}`;

  // Initialize Prisma client
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: `file:${dbPath}`,
      },
    },
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

  // Test connection and create schema
  try {
    await prisma.$connect();

    // Create tables if they don't exist
    await createSchemaIfNeeded(prisma);

    // Run migrations for existing databases
    await runMigrations(prisma);
  } catch (error) {
    console.error('Failed to connect to database:', error);
    throw error;
  }
}

async function createSchemaIfNeeded(prisma: PrismaClientType): Promise<void> {
  // Check if tables exist using sqlite_master (no error thrown if missing)
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name FROM sqlite_master WHERE type='table' AND name='local_config'
  `;
  if (rows.length > 0) return; // Tables already exist

  // Create all tables with updated schema
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS local_config (
      id TEXT PRIMARY KEY DEFAULT 'config',
      store_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      terminal_id TEXT NOT NULL,
      api_url TEXT NOT NULL,
      last_sync DATETIME DEFAULT CURRENT_TIMESTAMP,
      mode TEXT,
      pos_admin_locked INTEGER DEFAULT 0
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'USER',
      name_uz TEXT NOT NULL,
      name_ru TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      pin TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_uz TEXT NOT NULL,
      name_ru TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name_uz TEXT NOT NULL,
      name_ru TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      active INTEGER DEFAULT 1,
      balance REAL DEFAULT 0,
      payment_type TEXT DEFAULT 'IMMEDIATE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  // UPDATED PRODUCTS TABLE WITH NEW FIELDS
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE NOT NULL,
      name_uz TEXT NOT NULL,
      name_ru TEXT NOT NULL,
      price REAL NOT NULL,
      cost REAL,
      stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      unit TEXT DEFAULT 'шт',
      category_id INTEGER NOT NULL,
      supplier_id TEXT,
      production_date DATETIME,
      expiry_date DATETIME,
      discount_percent REAL DEFAULT 0,
      is_on_promotion INTEGER DEFAULT 0,
      pending_price REAL,
      pending_price_threshold REAL,
      mxik TEXT,
      product_type TEXT DEFAULT 'REGULAR',
      internal_code TEXT UNIQUE,
      bulk_quantity REAL DEFAULT 0,
      min_sale_qty REAL DEFAULT 0,
      max_sale_qty REAL DEFAULT 0,
      pieces_per_box INTEGER,
      box_price REAL,
      box_barcode TEXT UNIQUE,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      receipt_number TEXT UNIQUE NOT NULL,
      total_amount REAL NOT NULL,
      discount_amount REAL DEFAULT 0,
      final_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      terminal_id TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      synced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      barcode TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      pieces_per_unit INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS inventory_arrivals (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      cost REAL NOT NULL,
      total_cost REAL NOT NULL,
      supplier_id TEXT,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )
  `;

  // Retained only for shift returns tracking: sales:delete writes a 'delete_sale' row here and
  // computeSmenaStats() (smena-handlers.ts) reads it for the Z/X-report return count/amount. The
  // general AuditLog feature (model, server module, web page, sync) was removed.
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      phone TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS pre_weighed_items (
      id TEXT PRIMARY KEY,
      product_id INTEGER NOT NULL,
      internal_code TEXT NOT NULL,
      weight REAL NOT NULL,
      barcode TEXT UNIQUE NOT NULL,
      price_per_kg REAL NOT NULL,
      total_price REAL NOT NULL,
      status TEXT DEFAULT 'AVAILABLE',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      sold_at DATETIME,
      sale_id TEXT,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `;

  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS supplier_transactions (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      reference_id TEXT,
      reference_type TEXT,
      due_date DATETIME,
      paid_at DATETIME,
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )
  `;

  // Create indexes
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_expiry ON products(expiry_date)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_promotion ON products(is_on_promotion)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_mxik ON products(mxik)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_internal_code ON products(internal_code)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pre_weighed_barcode ON pre_weighed_items(barcode)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pre_weighed_status ON pre_weighed_items(status)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON supplier_transactions(supplier_id)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_supplier_transactions_type ON supplier_transactions(type)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_supplier_transactions_created ON supplier_transactions(created_at)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_sales_synced ON sales(synced)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_sales_created ON sales(created_at)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)`;
  await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_sync_queue_entity ON sync_queue(entity)`;

}

async function runMigrations(prisma: PrismaClientType): Promise<void> {
  // Migration 2: Add new product fields if they don't exist
  try {
    await prisma.$queryRaw`SELECT supplier_id FROM products LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN supplier_id TEXT`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN expiry_date DATETIME`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN discount_percent REAL DEFAULT 0`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN is_on_promotion INTEGER DEFAULT 0`;
  }

  // Migration 3: Add pending price fields for deferred price changes
  try {
    await prisma.$queryRaw`SELECT pending_price FROM products LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN pending_price REAL`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN pending_price_threshold REAL`;
  }

  // Migration 4: Add mxik column for tax classification code
  try {
    await prisma.$queryRaw`SELECT mxik FROM products LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN mxik TEXT`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_products_mxik ON products(mxik)`;
  }

  // Migration 5: Add weighted product fields
  try {
    await prisma.$queryRaw`SELECT product_type FROM products LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN product_type TEXT DEFAULT 'REGULAR'`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN internal_code TEXT`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN bulk_quantity REAL DEFAULT 0`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN min_sale_qty REAL DEFAULT 0`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN max_sale_qty REAL DEFAULT 0`;
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_internal_code ON products(internal_code)`;
  }

  // Migration 6: Add balance column to suppliers
  try {
    await prisma.$queryRaw`SELECT balance FROM suppliers LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE suppliers ADD COLUMN balance REAL DEFAULT 0`;
  }

  // Migration 7: Add production_date column to products
  try {
    await prisma.$queryRaw`SELECT production_date FROM products LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN production_date DATETIME`;
  }

  // Migration 10: Deduplicate categories (caused by sync using VPS IDs instead of nameUz)
  const dupCount = await prisma.$queryRaw<{ cnt: number }[]>`
    SELECT COUNT(*) as cnt FROM categories
    WHERE id NOT IN (SELECT MAX(id) FROM categories GROUP BY name_uz)
  `;
  if (dupCount[0]?.cnt > 0) {
    // Disable FK checks so we can remap products safely
    await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;
    try {
      // Remap products to the canonical (max/VPS) category ID
      await prisma.$executeRaw`
        UPDATE products
        SET category_id = (
          SELECT MAX(c2.id) FROM categories c2
          WHERE c2.name_uz = (SELECT name_uz FROM categories WHERE id = products.category_id)
        )
        WHERE category_id IN (SELECT id FROM categories WHERE id NOT IN (SELECT MAX(id) FROM categories GROUP BY name_uz))
      `;
      // Delete the old local-seeded duplicate categories
      await prisma.$executeRaw`
        DELETE FROM categories
        WHERE id NOT IN (SELECT MAX(id) FROM categories GROUP BY name_uz)
      `;
    } finally {
      await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
    }
  }

  // Migration 11: Create supplier_transactions table
  try {
    await prisma.$queryRaw`SELECT 1 FROM supplier_transactions LIMIT 1`;
  } catch {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS supplier_transactions (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payment_method TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT,
        reference_id TEXT,
        reference_type TEXT,
        due_date DATETIME,
        paid_at DATETIME,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON supplier_transactions(supplier_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_supplier_transactions_type ON supplier_transactions(type)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_supplier_transactions_created ON supplier_transactions(created_at)`;
  }

  // Migration 9: Create pre_weighed_items table
  try {
    await prisma.$queryRaw`SELECT 1 FROM pre_weighed_items LIMIT 1`;
  } catch {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS pre_weighed_items (
        id TEXT PRIMARY KEY,
        product_id INTEGER NOT NULL,
        internal_code TEXT NOT NULL,
        weight REAL NOT NULL,
        barcode TEXT UNIQUE NOT NULL,
        price_per_kg REAL NOT NULL,
        total_price REAL NOT NULL,
        status TEXT DEFAULT 'AVAILABLE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        sold_at DATETIME,
        sale_id TEXT,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pre_weighed_barcode ON pre_weighed_items(barcode)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_pre_weighed_status ON pre_weighed_items(status)`;
  }

  // Migration 12: Smena (shift) management — tables
  try {
    await prisma.$queryRaw`SELECT id FROM smenas LIMIT 1`;
  } catch {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS smenas (
        id TEXT PRIMARY KEY,
        terminal_id TEXT NOT NULL,
        cashier_id TEXT NOT NULL,
        cashier_name TEXT NOT NULL,
        status TEXT DEFAULT 'OPEN',
        initial_cash REAL NOT NULL,
        final_cash REAL,
        z_report_number INTEGER NOT NULL DEFAULT 0,
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        synced INTEGER DEFAULT 0
      )
    `;
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS smena_movements (
        id TEXT PRIMARY KEY,
        smena_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (smena_id) REFERENCES smenas(id)
      )
    `;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_smenas_status ON smenas(terminal_id, status)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_smena_movements ON smena_movements(smena_id)`;
  }

  // Migration 12b: smena_id column on sales (separate guard — runs even if smenas table already existed)
  try {
    await prisma.$queryRaw`SELECT smena_id FROM sales LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN smena_id TEXT`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_sales_smena ON sales(smena_id)`;
  }

  // Migration 13: store_id column on users for per-store filtering
  try {
    await prisma.$queryRaw`SELECT store_id FROM users LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE users ADD COLUMN store_id TEXT`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_users_store ON users(store_id)`;
  }

  // Migration 15: Per-store sequential product code
  // Reset the product sync cursor so the next sync re-pulls all products and
  // populates store_product_code from the VPS — avoids a mixed-state display
  // where some products show per-store codes and others still show global IDs.
  try {
    await prisma.$queryRaw`SELECT store_product_code FROM products LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN store_product_code INTEGER`;
    await prisma.$executeRaw`
      UPDATE system_settings SET value = ${new Date(0).toISOString()} WHERE key = 'last_product_sync'
    `;
  }

  // Migration 16: Add payment_type column to suppliers
  try {
    await prisma.$queryRaw`SELECT payment_type FROM suppliers LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE suppliers ADD COLUMN payment_type TEXT DEFAULT 'IMMEDIATE'`;
  }

  // Migration 17: Add mxik_group_code to categories (group 022 marking code support)
  try {
    await prisma.$queryRaw`SELECT mxik_group_code FROM categories LIMIT 1`;
  } catch {
    await prisma.$executeRaw`ALTER TABLE categories ADD COLUMN mxik_group_code TEXT`;
  }

  // Migration 18: Create sold_marking_codes table (unique QR resale prevention)
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS sold_marking_codes (
      id             TEXT PRIMARY KEY,
      code           TEXT NOT NULL UNIQUE,
      product_barcode TEXT,
      terminal_id    TEXT NOT NULL,
      sold_at        DATETIME NOT NULL DEFAULT (datetime('now')),
      synced         INTEGER NOT NULL DEFAULT 0
    )
  `;

  // Migration 19: REGOS:VCR fiscalization columns on sales
  // (column-existence checked via pragma_table_info so a missing column does not
  // emit a noisy prisma:error like the older SELECT-probe migrations above)
  if (!(await columnExists(prisma, 'sales', 'fiscal_status'))) {
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN fiscal_status TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN fiscal_attempts INTEGER DEFAULT 0`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN fiscal_error TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_receipt_id TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_fiscal_sign TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_qr_code_url TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_terminal_id TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_receipt_no TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_fiscal_at DATETIME`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_labels TEXT`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_sales_fiscal_status ON sales(fiscal_status)`;
  }

  // Migration 20: REGOS:VCR package code on products
  if (!(await columnExists(prisma, 'products', 'package_code'))) {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN package_code TEXT`;
  }

  // Migration 21: REGOS:VCR Z-report id on smenas
  if (!(await columnExists(prisma, 'smenas', 'regos_z_report_id'))) {
    await prisma.$executeRaw`ALTER TABLE smenas ADD COLUMN regos_z_report_id INTEGER`;
  }

  // Migration 22: refunded flag on sales (set once a fiscal full refund is issued)
  if (!(await columnExists(prisma, 'sales', 'refunded'))) {
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN refunded INTEGER DEFAULT 0`;
  }

  // Migration 23: Create pending_marking_codes table (group 022 codes sold IN circulation,
  // captured for later REGOS:VCR out-of-circulation fiscalization)
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS pending_marking_codes (
      id                 TEXT PRIMARY KEY,
      code               TEXT NOT NULL UNIQUE,
      product_barcode    TEXT,
      sale_id            TEXT,
      terminal_id        TEXT NOT NULL,
      circulation_status TEXT,
      fiscalized         INTEGER NOT NULL DEFAULT 0,
      synced             INTEGER NOT NULL DEFAULT 0,
      created_at         DATETIME NOT NULL DEFAULT (datetime('now'))
    )
  `;

  // Migration 24: per-product VAT rate (% — e.g. 0, 6 or 12). Null → use global regos_vcr_vat default.
  // REAL so fractional rates round-trip; SQLite type affinity stores whole rates (0/6/12) losslessly
  // and existing terminals (column already INTEGER affinity) handle these whole values fine.
  if (!(await columnExists(prisma, 'products', 'vat_rate'))) {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN vat_rate REAL`;
  }

  // Migration 25: authoritative Asl-Belgisi marking flag from tasnif `label` (1 = marked, 0 = plain).
  // Null (default for existing rows) = not yet checked → the POS falls back to the isMarkedMxik
  // group heuristic. Backfilled on the VPS (scripts/backfill-is-marked.ts) and synced down.
  if (!(await columnExists(prisma, 'products', 'is_marked'))) {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN is_marked INTEGER`;
  }

  // Migration 26: multi-piece pack ("box") — sell a product per piece or as a sealed pack of N.
  // Stock stays counted in PIECES; a box sale decrements pieces_per_box. Null/1 pieces_per_box
  // (every pre-existing row) means "not boxed", so behaviour is unchanged until an admin sets it.
  if (!(await columnExists(prisma, 'products', 'pieces_per_box'))) {
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN pieces_per_box INTEGER`;
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN box_price REAL`;
    // SQLite can't add a UNIQUE column via ALTER TABLE — create the index separately.
    await prisma.$executeRaw`ALTER TABLE products ADD COLUMN box_barcode TEXT`;
    await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS products_box_barcode_key ON products(box_barcode)`;
  }

  // pieces_per_unit records how many pieces one sold `quantity` unit held (1 = piece, N = box),
  // so stock restores correctly on receipt edit/delete and the fiscal quantity converts to pieces.
  if (!(await columnExists(prisma, 'sale_items', 'pieces_per_unit'))) {
    await prisma.$executeRaw`ALTER TABLE sale_items ADD COLUMN pieces_per_unit INTEGER NOT NULL DEFAULT 1`;
  }

  // Cached store operating mode. `mode` stays NULL until the terminal is activated against a
  // server, and NULL plus pos_admin_locked = 0 is exactly today's behavior — so an existing
  // install upgrades in place without any change until a super admin opts it in.
  if (!(await columnExists(prisma, 'local_config', 'mode'))) {
    await prisma.$executeRaw`ALTER TABLE local_config ADD COLUMN mode TEXT`;
  }
  if (!(await columnExists(prisma, 'local_config', 'pos_admin_locked'))) {
    await prisma.$executeRaw`ALTER TABLE local_config ADD COLUMN pos_admin_locked INTEGER NOT NULL DEFAULT 0`;
  }

  // Migration 27: UzQR payment identifiers on sales. Added to the Prisma schema with the UzQR
  // feature but never to this file, so the generated client asked every INSERT for two columns
  // no local database has ever had — every sale failed with P2022 until someone happened to run
  // `prisma db push` against their own DB. Nullable and unused by older rows.
  if (!(await columnExists(prisma, 'sales', 'regos_payment_id'))) {
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_payment_id TEXT`;
    await prisma.$executeRaw`ALTER TABLE sales ADD COLUMN regos_payment_rrn TEXT`;
  }

  // Migration 28: the quick-login PIN moves from the terminal (local_config.store_pin) to the
  // person (users.pin), so every cashier and admin gets their own. The old single store PIN
  // signed you in as the first active cashier, so that is exactly the account it is handed to —
  // the same PIN keeps opening the same session after the upgrade. local_config.store_pin is
  // left in place but is no longer read by anything (SQLite cannot drop a column in place).
  if (!(await columnExists(prisma, 'users', 'pin'))) {
    await prisma.$executeRaw`ALTER TABLE users ADD COLUMN pin TEXT`;

    if (await columnExists(prisma, 'local_config', 'store_pin')) {
      const rows = await prisma.$queryRaw<{ store_pin: string | null }[]>`
        SELECT store_pin FROM local_config WHERE id = 'config'
      `;
      const legacyPin = rows[0]?.store_pin ?? null;
      if (legacyPin) {
        const result = await prisma.$executeRaw`
          UPDATE users SET pin = ${legacyPin}
          WHERE id = (
            SELECT id FROM users
            WHERE role = 'USER' AND active = 1
            ORDER BY created_at ASC LIMIT 1
          )
        `;
        console.log(
          result > 0
            ? '[migration 28] store PIN carried over to the first active cashier'
            : '[migration 28] store PIN dropped — no active cashier to carry it over to',
        );
      }
    }
  }
}

/** True if `column` exists on `table` — silent (no thrown query, no prisma:error log). */
async function columnExists(
  prisma: PrismaClientType,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`,
    column,
  )) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

// Export prisma instance for direct use
export { prisma };
