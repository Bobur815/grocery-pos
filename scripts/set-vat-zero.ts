// Set products.vat_rate = 0 for every product (PostgreSQL / VPS).
//
// Use this only when the whole catalog is VAT-exempt (e.g. a shop selling only 0% staples). For a
// MIXED catalog use backfill-vat-rate-regos.ts instead — a blanket 0% makes genuinely 12% goods
// fail fiscalization with the inverse 701003 "Ставка НДС не найдена".
//
// Writes via Prisma updateMany so @updatedAt bumps → terminals pull the change on next
// products-sync (products-sync.ts requests ?updatedAfter=<cursor>, so the row MUST get a fresh
// updated_at to be re-pulled; a raw `UPDATE ... SET vat_rate=0` would NOT bump it and never sync).
//
// Run (reads DATABASE_URL from .env — point it at the right DB):
//   npx tsx scripts/set-vat-zero.ts                 # DRY RUN — counts only, writes nothing
//   npx tsx scripts/set-vat-zero.ts --apply         # writes vat_rate=0
//
// Filters via env: STORE_ID (default 1234; set ALL to ignore).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const STORE_ID = process.env.STORE_ID === 'ALL' ? undefined : (process.env.STORE_ID ?? '1234');

async function main() {
  const where = STORE_ID ? { storeId: STORE_ID } : {};
  const total = await prisma.product.count({ where });
  const alreadyZero = await prisma.product.count({ where: { ...where, vatRate: 0 } });

  console.log(`\nStore=${STORE_ID ?? 'ALL'} — ${total} products (${alreadyZero} already 0%)`);
  console.log(APPLY ? '>>> APPLY — setting vat_rate=0\n' : '>>> DRY RUN — pass --apply to write\n');

  if (APPLY) {
    const res = await prisma.product.updateMany({ where, data: { vatRate: 0 } });
    console.log(`Updated ${res.count} products to vat_rate=0 (updated_at bumped → will sync to terminals).`);
  } else {
    console.log(`Would set vat_rate=0 on ${total} products.`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
