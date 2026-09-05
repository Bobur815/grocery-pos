import { getPrismaClient } from './sqlite-client';

export async function seedLocalDatabase(): Promise<void> {
  const prisma = getPrismaClient();

  // ── LocalConfig ───────────────────────────────────────────────────────────
  // Only create if absent — setup wizard overwrites with real values afterward
  const existingConfig = await prisma.localConfig.findUnique({
    where: { id: 'config' },
    select: { id: true },
  });

  if (!existingConfig) {
    await prisma.localConfig.create({
      data: {
        id: 'config',
        storeId: process.env.STORE_ID || '',
        storeName: process.env.STORE_NAME || '',
        terminalId: process.env.TERMINAL_ID || 'T1',
        apiUrl: process.env.VPS_API_URL || 'https://pos.bobur-dev.uz/api',
      },
    });
  }

  // ── System Settings ───────────────────────────────────────────────────────
  // update: {} means existing values are never overwritten — safe to run on every boot
  const defaults = [
    { key: 'tax_rate',            value: '0' },
    { key: 'receipt_header',      value: '' },
    { key: 'receipt_footer',      value: '' },
    { key: 'currency',            value: 'UZS' },
    { key: 'currency_symbol',     value: "so'm" },
    { key: 'sync_interval',       value: '5' },
    { key: 'last_product_sync',   value: new Date(0).toISOString() },
    { key: 'last_sale_sync',      value: new Date(0).toISOString() },
    { key: 'default_language',    value: 'uz' },
    { key: 'default_theme',       value: 'light' },
    { key: 'printer_enabled',     value: 'false' },
    { key: 'printer_name',        value: '' },
  ];

  for (const setting of defaults) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }
}
