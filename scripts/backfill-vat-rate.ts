// Backfill products.vat_rate from the product's MXIK via tasnif.soliq.uz.
//
// REGOS:VCR resolves a position's VAT rate from its MXIK (icps) in the soliq tax registry. A
// product registered as VAT-able that is fiscalized with vat_value=0 is rejected with
// 701003 "Ставка НДС не найдена". We carry the rate per product in products.vat_rate (percent).
//
// The rate is derived from the public tasnif elasticsearch card:
//   GET cls-api/elasticsearch/search?lang=uz_cyrl&search={mxik}&size=20&page=0 → data[].lgotaId
//   lgotaId === null  → no VAT exemption (льгота) attached → standard 12%
//   lgotaId !== null  → an exemption is *attached in the registry* → flagged for REVIEW, still 12%
//
// IMPORTANT: lgotaId means an exemption is attached, NOT that it is currently in force. tasnif
// keeps abolished/expired/mis-attached льготы. Verified 2026-06-16 on store 1234: all 60 lgota
// hits were false — Art.243 п.13 "medicines" (abolished 01.04.2024) on sodas/salt/detergent, or
// an expired Art.483 food benefit. So lgota does NOT auto-zero by default. After manually
// confirming a льгота is in force (Tax Code arts. 243–246), pass --trust-lgota to write those 0%.
//
// Run (reads DATABASE_URL from .env — point it at the right DB):
//   npx tsx scripts/backfill-vat-rate.ts                 # DRY RUN — prints plan, writes nothing
//   npx tsx scripts/backfill-vat-rate.ts --apply         # writes 12% for valid-MXIK rows
//   npx tsx scripts/backfill-vat-rate.ts --apply --trust-lgota  # also writes 0% for lgota rows
//
// Filters via env: STORE_ID (default 1234), CATEGORY_ID (default 1; set ALL to ignore category).
//   STORE_ID=1234 CATEGORY_ID=1   npx tsx scripts/backfill-vat-rate.ts --apply
//   STORE_ID=1234 CATEGORY_ID=ALL npx tsx scripts/backfill-vat-rate.ts --apply
//
// Idempotent (only touches vat_rate IS NULL — never overrides a manually-set rate), sequential +
// rate-limited (gentle on tasnif), resumable. Server/PG operation — terminals pull vat_rate via
// products-sync; no Electron rebuild needed.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';
const APPLY = process.argv.includes('--apply');
// By default a registry lgota is treated as a REVIEW signal only — it is NOT auto-zero-rated,
// because tasnif lists abolished/expired/mis-attached льготы (verified 2026-06-16: every lgota
// hit in store 1234 was Art.243 п.13 "medicines" — abolished 01.04.2024 — or an expired Art.483
// food benefit, none on goods that are actually exempt). Pass --trust-lgota only after manually
// confirming the listed льготы are currently in force; then lgota products are written as 0%.
const TRUST_LGOTA = process.argv.includes('--trust-lgota');
const STORE_ID = process.env.STORE_ID ?? '1234';
const CATEGORY_ID = process.env.CATEGORY_ID === 'ALL' ? undefined : Number(process.env.CATEGORY_ID ?? 1);
const STANDARD_VAT = 12; // UZ statutory rate when no (in-force) exemption is attached
const EXEMPT_VAT = 0; // exemption (льгота) attached → 0%
const DELAY_MS = 150; // pause between tasnif calls; raise if throttled

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface VatCard {
  rate: number; // resolved rate to write (honours TRUST_LGOTA)
  hasLgota: boolean; // a льгота is attached in the registry (in force or not)
  via: string;
}

/** Resolve a product's VAT info from its MXIK via the public tasnif elasticsearch card. */
async function fetchVatRate(mxik: string): Promise<VatCard> {
  // 10s timeout — without it a single stalled request hangs the whole run.
  const res = await fetch(
    `${TASNIF}/elasticsearch/search?lang=uz_cyrl&search=${mxik}&size=20&page=0`,
    { signal: AbortSignal.timeout(10_000) },
  );
  const json = (await res.json()) as {
    data?: Array<{ mxikCode?: string; lgotaId?: string | null; lgotaName?: string | null }>;
  };
  const rows = json?.data ?? [];
  // Prefer the exact MXIK match; the search can return siblings.
  const card = rows.find((r) => r.mxikCode === mxik) ?? rows[0];
  if (!card) return { rate: STANDARD_VAT, hasLgota: false, via: 'no card → 12%' };
  if (card.lgotaId != null) {
    const note = `lgota ${card.lgotaId}: ${(card.lgotaName ?? '').slice(0, 60)}`;
    // Default: keep 12% (registry lgota is unreliable for current status); --trust-lgota → 0%.
    return TRUST_LGOTA
      ? { rate: EXEMPT_VAT, hasLgota: true, via: `0% (trusted) ${note}` }
      : { rate: STANDARD_VAT, hasLgota: true, via: `12% — REVIEW ${note}` };
  }
  return { rate: STANDARD_VAT, hasLgota: false, via: 'no lgota → 12%' };
}

async function main() {
  const products = await prisma.product.findMany({
    where: {
      storeId: STORE_ID,
      ...(CATEGORY_ID !== undefined ? { categoryId: CATEGORY_ID } : {}),
      vatRate: null,
    },
    select: { id: true, nameUz: true, mxik: true },
    orderBy: { id: 'asc' },
  });

  console.log(
    `\nStore=${STORE_ID} Category=${CATEGORY_ID ?? 'ALL'} — ${products.length} rows with NULL vat_rate`,
  );
  console.log(APPLY ? '>>> APPLY mode — writing changes\n' : '>>> DRY RUN — pass --apply to write\n');

  const skipped: Array<{ id: number; nameUz: string; reason: string }> = [];
  const review: Array<{ id: number; nameUz: string; via: string }> = [];
  let updated = 0;

  for (const p of products) {
    if (!p.mxik || !/^[0-9]{17}$/.test(p.mxik)) {
      skipped.push({ id: p.id, nameUz: p.nameUz, reason: `bad/empty mxik (${p.mxik ?? 'null'})` });
      continue;
    }
    try {
      const { rate, hasLgota, via } = await fetchVatRate(p.mxik);
      console.log(`#${p.id} ${p.nameUz.slice(0, 32).padEnd(32)} mxik=${p.mxik} → ${rate}%  (${via})`);
      if (hasLgota) review.push({ id: p.id, nameUz: p.nameUz, via });
      if (APPLY) {
        await prisma.product.update({ where: { id: p.id }, data: { vatRate: rate } });
        updated++;
      }
    } catch (e) {
      skipped.push({
        id: p.id,
        nameUz: p.nameUz,
        reason: `tasnif error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    await sleep(DELAY_MS);
  }

  console.log(
    `\nDone. ${APPLY ? `Updated ${updated}.` : 'Dry run — nothing written.'}  ` +
      `lgota-flagged ${review.length} (written ${TRUST_LGOTA ? '0%' : '12% — manual review'}).  Skipped ${skipped.length}.`,
  );
  if (review.length) {
    console.log(
      `\nlgota attached — ${TRUST_LGOTA ? 'WROTE 0%' : 'kept 12%'}. VERIFY each is currently in force` +
        ' (Tax Code arts. 243–246); registry lists abolished/expired льготы:',
    );
    for (const r of review) console.log(`  #${r.id} ${r.nameUz} — ${r.via}`);
  }
  if (skipped.length) {
    console.log('\nSkipped — no valid 17-digit MXIK (cannot fiscalize until fixed):');
    for (const s of skipped) console.log(`  #${s.id} ${s.nameUz} — ${s.reason}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
