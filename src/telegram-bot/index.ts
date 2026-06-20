import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// A `PrismaClientRustPanicError` ("timer has gone away" etc.) is non-recoverable:
// once the query engine panics, the client instance is dead and every subsequent
// query fails the same way. The only safe recovery is to exit and let PM2 restart
// the process with a fresh engine.
function isPrismaEnginePanic(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'PrismaClientRustPanicError';
}
function exitOnEnginePanic(err: unknown): void {
  if (isPrismaEnginePanic(err)) {
    console.error('[telegram-bot] Prisma engine panic — restarting process so PM2 spawns a fresh engine');
    process.exit(1);
  }
}

type Lang = 'uz' | 'ru';
type UserRole = 'ADMIN' | 'USER' | 'SUPER_ADMIN' | 'SUPPLIER';

interface BotSession {
  phone: string;
  role: UserRole;
  userId?: string;
  supplierId?: string;
  storeId: string;
  name: string;
  lang: Lang;
}

// ─── Button labels ────────────────────────────────────────────────────────────

const BTN_UZ = {
  ANALYTICS: "📊 Bugungi tahlil",
  LOW_STOCK: "🔴 Kam qolganlar",
  SUPPLIERS: "👥 Ta'minotchilar",
  STORES: "🏪 Do'konlar",
  BALANCE: "💰 Mening balansim",
  TRANSACTIONS: "📋 Tranzaksiyalar",
  MY_PRODUCTS: "📦 Mening tovarlarim",
  WEB: "🌐 Veb-panel",
} as const;

const BTN_RU = {
  ANALYTICS: "📊 Аналитика",
  LOW_STOCK: "🔴 Мало на складе",
  SUPPLIERS: "👥 Поставщики",
  STORES: "🏪 Магазины",
  BALANCE: "💰 Мой баланс",
  TRANSACTIONS: "📋 Транзакции",
  MY_PRODUCTS: "📦 Мои товары",
  WEB: "🌐 Веб-панель",
} as const;

const ALL_BTNS: Record<keyof typeof BTN_UZ, string[]> = {
  ANALYTICS:    [BTN_UZ.ANALYTICS,    BTN_RU.ANALYTICS],
  LOW_STOCK:    [BTN_UZ.LOW_STOCK,    BTN_RU.LOW_STOCK],
  SUPPLIERS:    [BTN_UZ.SUPPLIERS,    BTN_RU.SUPPLIERS],
  STORES:       [BTN_UZ.STORES,       BTN_RU.STORES],
  BALANCE:      [BTN_UZ.BALANCE,      BTN_RU.BALANCE],
  TRANSACTIONS: [BTN_UZ.TRANSACTIONS, BTN_RU.TRANSACTIONS],
  MY_PRODUCTS:  [BTN_UZ.MY_PRODUCTS,  BTN_RU.MY_PRODUCTS],
  WEB:          [BTN_UZ.WEB,          BTN_RU.WEB],
};

function btn(key: keyof typeof BTN_UZ, lang: Lang) {
  return lang === 'uz' ? BTN_UZ[key] : BTN_RU[key];
}

// ─── Keyboards ────────────────────────────────────────────────────────────────

function kbAskPhone(lang: Lang) {
  const label = lang === 'uz' ? '📱 Raqamni ulashish' : '📱 Поделиться номером';
  return Markup.keyboard([[Markup.button.contactRequest(label)]]).oneTime().resize();
}
function kbAdmin(lang: Lang) {
  return Markup.keyboard([
    [btn('ANALYTICS', lang), btn('LOW_STOCK', lang)],
    [btn('SUPPLIERS', lang), btn('WEB', lang)]
  ]).resize();
}
function kbSuperAdmin(lang: Lang) {
  return Markup.keyboard([[btn('STORES', lang)], [btn('WEB', lang)]]).resize();
}
function kbSupplier(lang: Lang) {
  return Markup.keyboard([
    [btn('BALANCE', lang), btn('TRANSACTIONS', lang)],
    [btn('MY_PRODUCTS', lang)],
  ]).resize();
}
function inlineWebButton() {
  const url = process.env.WEB_APP_URL ?? 'https://pos.bobur-dev.uz';
  return Markup.inlineKeyboard([Markup.button.url('🌐 Veb-panel / Открыть веб-панель', url)]);
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function digitsOnly(s: string) { return s.replace(/\D/g, ''); }

async function resolveIdentity(rawPhone: string): Promise<Omit<BotSession, 'lang'> | null> {
  const variants = [digitsOnly(rawPhone), `+${digitsOnly(rawPhone)}`];
  for (const phone of variants) {
    const user = await prisma.user.findFirst({ where: { phone } });
    if (user) return { phone, role: user.role as UserRole, userId: user.id, storeId: user.storeId ?? '', name: user.nameRu };
  }
  for (const phone of variants) {
    const supplier = await prisma.supplier.findFirst({ where: { phone } });
    if (supplier) return { phone, role: 'SUPPLIER', supplierId: supplier.id, storeId: supplier.storeId ?? '', name: supplier.nameRu };
  }
  return null;
}

// ─── Bot setup ────────────────────────────────────────────────────────────────

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN not set');
  process.exit(1);
}

const bot = new Telegraf(token);

// ─── Persistent sessions ───────────────────────────────────────────────────────
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

function loadSessions(): Map<number, BotSession> {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const obj = JSON.parse(raw) as Record<string, BotSession>;
    return new Map(Object.entries(obj).map(([k, v]) => [Number(k), v]));
  } catch {
    return new Map();
  }
}

function saveSessions(map: Map<number, BotSession>): void {
  const obj: Record<string, BotSession> = {};
  map.forEach((v, k) => { obj[k] = v; });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
}

const sessions = loadSessions();
const langPrefs = new Map<number, Lang>();

function getLang(chatId: number): Lang {
  return sessions.get(chatId)?.lang ?? langPrefs.get(chatId) ?? 'ru';
}

// /start
bot.start(async (ctx) => {
  sessions.delete(ctx.chat.id);
  saveSessions(sessions);
  langPrefs.delete(ctx.chat.id);
  await ctx.reply(
    'Tilni tanlang / Выберите язык:',
    Markup.inlineKeyboard([
      Markup.button.callback("O'zbek 🇺🇿", 'lang_uz'),
      Markup.button.callback('Русский 🇷🇺', 'lang_ru'),
    ]),
  );
});

bot.action('lang_uz', async (ctx) => {
  if (!ctx.chat) return;
  langPrefs.set(ctx.chat.id, 'uz');
  await ctx.answerCbQuery();
  await ctx.editMessageText("O'zbek tili tanlandi ✅");
  setTimeout(() => ctx.deleteMessage().catch(() => {}), 1500);
  await ctx.reply("Telefon raqamingizni ulashing:", kbAskPhone('uz'));
});

bot.action('lang_ru', async (ctx) => {
  if (!ctx.chat) return;
  langPrefs.set(ctx.chat.id, 'ru');
  await ctx.answerCbQuery();
  await ctx.editMessageText('Выбран русский язык ✅');
  setTimeout(() => ctx.deleteMessage().catch(() => {}), 1500);
  await ctx.reply("Поделитесь номером телефона:", kbAskPhone('ru'));
});

// Contact
bot.on('contact', async (ctx) => {
  const lang = getLang(ctx.chat.id);
  try {
    const identity = await resolveIdentity(ctx.message.contact.phone_number);
    if (!identity) {
      await ctx.reply(lang === 'uz' ? '❌ Raqam topilmadi.' : '❌ Номер не найден.');
      return;
    }
    const session: BotSession = { ...identity, lang };
    sessions.set(ctx.chat.id, session);
    saveSessions(sessions);
    if (session.role === 'SUPPLIER') {
      await ctx.reply(lang === 'uz' ? `Xush kelibsiz, ${session.name}!` : `Добро пожаловать, ${session.name}!`, kbSupplier(lang));
    } else if (session.role === 'SUPER_ADMIN') {
      await ctx.reply(lang === 'uz' ? `Super admin: ${session.name}` : `Супер-админ: ${session.name}`, kbSuperAdmin(lang));
    } else {
      await ctx.reply(lang === 'uz' ? `Xush kelibsiz, ${session.name}!` : `Добро пожаловать, ${session.name}!`, kbAdmin(lang));
    }
  } catch (err) {
    console.error('Contact handler error', err);
    await ctx.reply(lang === 'uz' ? '❌ Xatolik.' : '❌ Ошибка.');
  }
});

// Stores (super admin)
bot.hears(ALL_BTNS.STORES, async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session || session.role !== 'SUPER_ADMIN') return;
  const stores = await prisma.store.findMany({ include: { _count: { select: { users: true, products: true, sales: true } } } });
  const lines = stores.map(s => `• *${s.name}* (${s.subscriptionPlan ?? s.aiPlan}) — ${s._count.sales} sotuv`).join('\n');
  await ctx.replyWithMarkdown(lines || (session.lang === 'uz' ? 'Do\'konlar yo\'q' : 'Нет магазинов'));
});

// Analytics (admin)
bot.hears(ALL_BTNS.ANALYTICS, async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session || session.role === 'SUPPLIER' || session.role === 'SUPER_ADMIN' || !session.storeId) return;
  const today = new Date(); today.setHours(0,0,0,0);
  const sales = await prisma.sale.findMany({ where: { storeId: session.storeId, createdAt: { gte: today } } });
  const revenue = sales.reduce((s, x) => s + Number(x.finalAmount), 0);
  await ctx.replyWithMarkdown(
    session.lang === 'uz'
      ? `📊 *Bugungi tahlil*\nSotuvlar: ${sales.length}\nTushum: ${revenue.toLocaleString('ru-RU')} so'm`
      : `📊 *Аналитика за сегодня*\nПродажи: ${sales.length}\nВыручка: ${revenue.toLocaleString('ru-RU')} сум`,
  );
});

// Low stock
bot.hears(ALL_BTNS.LOW_STOCK, async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session || session.role === 'SUPPLIER' || session.role === 'SUPER_ADMIN' || !session.storeId) return;
  const products = await prisma.product.findMany({
    where: { storeId: session.storeId, active: true, stock: { lte: prisma.product.fields.minStock } },
    take: 30,
  });
  // Fallback: compare manually
  const allProducts = await prisma.product.findMany({ where: { storeId: session.storeId, active: true } });
  const low = allProducts.filter(p => Number(p.stock) <= Number(p.minStock));
  const header = session.lang === 'uz' ? '🔴 *Kam qolganlar*' : '🔴 *Мало на складе*';
  const empty  = session.lang === 'uz' ? 'Hammasi yetarli ✅' : 'Всё в норме ✅';
  if (low.length === 0) {
    await ctx.replyWithMarkdown(`${header}\n${empty}`);
  } else {
    const itemLines = low.map(p => `• ${p.nameRu}: ${Number(p.stock)}/${Number(p.minStock)} ${p.unit}`);
    // Split into chunks that fit within Telegram's 4096-char limit
    const chunks: string[] = [];
    let chunk = header;
    for (const line of itemLines) {
      if (chunk.length + 1 + line.length > 4000) {
        chunks.push(chunk);
        chunk = line;
      } else {
        chunk += (chunk === header ? '\n' : '\n') + line;
      }
    }
    chunks.push(chunk);
    for (const msg of chunks) await ctx.replyWithMarkdown(msg);
  }
});

// Suppliers
bot.hears(ALL_BTNS.SUPPLIERS, async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session || session.role === 'SUPPLIER' || session.role === 'SUPER_ADMIN' || !session.storeId) return;
  const suppliers = await prisma.supplier.findMany({ where: { storeId: session.storeId, active: true } });
  const lines = suppliers.map(s => `• ${s.nameRu}: ${Number(s.balance).toLocaleString('ru-RU')} so'm`).join('\n');
  await ctx.replyWithMarkdown(`👥 *Ta'minotchilar / Поставщики*\n${lines || '—'}`);
});

// Supplier balance
bot.hears(ALL_BTNS.BALANCE, async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session || session.role !== 'SUPPLIER' || !session.supplierId) return;
  const supplier = await prisma.supplier.findUnique({ where: { id: session.supplierId } });
  if (!supplier) return;
  await ctx.replyWithMarkdown(
    session.lang === 'uz'
      ? `💰 *Balans*: ${Number(supplier.balance).toLocaleString('ru-RU')} so'm`
      : `💰 *Баланс*: ${Number(supplier.balance).toLocaleString('ru-RU')} сум`,
  );
});

// Supplier transactions
bot.hears(ALL_BTNS.TRANSACTIONS, async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session || session.role !== 'SUPPLIER' || !session.supplierId) return;
  const txs = await prisma.supplierTransaction.findMany({
    where: { supplierId: session.supplierId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const lines = txs.map(tx => `• ${tx.type}: ${Number(tx.amount).toLocaleString('ru-RU')} — ${tx.description ?? ''}`).join('\n');
  await ctx.replyWithMarkdown(`📋 *Tranzaksiyalar*\n${lines || '—'}`);
});

// Supplier products
bot.hears(ALL_BTNS.MY_PRODUCTS, async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session || session.role !== 'SUPPLIER' || !session.supplierId) return;
  const products = await prisma.product.findMany({ where: { supplierId: session.supplierId, active: true } });
  const lines = products.map(p => `• ${p.nameRu}: ${Number(p.stock)} ${p.unit}`).join('\n');
  await ctx.replyWithMarkdown(`📦 *Mening tovarlarim*\n${lines || '—'}`);
});

// Web panel
bot.hears(ALL_BTNS.WEB, async (ctx) => {
  const lang = getLang(ctx.chat.id);
  const label = lang === 'uz' ? 'Quyidagi tugmani bosing:' : 'Нажмите кнопку ниже:';
  await ctx.reply(label, inlineWebButton());
});

// Fallback
bot.on('message', async (ctx) => {
  if (!sessions.has(ctx.chat.id)) {
    await ctx.reply(
      'Tilni tanlang / Выберите язык:',
      Markup.inlineKeyboard([
        Markup.button.callback("O'zbek 🇺🇿", 'lang_uz'),
        Markup.button.callback('Русский 🇷🇺', 'lang_ru'),
      ]),
    );
  }
});

// ─── Launch ───────────────────────────────────────────────────────────────────

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Safety net: an engine panic surfacing outside an awaited try/catch still bricks
// the client, so exit and let PM2 restart with a fresh engine.
process.on('unhandledRejection', exitOnEnginePanic);
process.on('uncaughtException', exitOnEnginePanic);

// Connect the query engine up front. Lazy connect-on-first-query lets several
// forwarded receipts race the engine's startup, which is what triggered the
// "timer has gone away" panic. Starting it before we poll for updates avoids that.
prisma.$connect()
  .then(() => bot.launch())
  .then(() => console.log('[telegram-bot] Started'))
  .catch((err) => { console.error('[telegram-bot] Launch error', err); process.exit(1); });
