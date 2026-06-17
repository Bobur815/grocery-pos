// Backfill products.vat_rate by probing REGOS:VCR — the AUTHORITATIVE VAT-rate oracle.
//
// Why not tasnif: the public tasnif card carries NO VAT field, and its `lgotaId` is unreliable
// (verified 2026-06-17: bread MXIK 01905002007000000 has lgotaId=null yet REGOS rejects 12% for
// it — it is registered VAT-exempt 0%). So tasnif cannot tell us the rate. REGOS can: it resolves
// each position's rate from the MXIK in the soliq FDA registry and rejects a wrong rate with
// 701003 "Ставка НДС не найдена". We exploit that with Receipt.ValidateSale (no print, no fiscal
// side effect): probe vat_value=0 → passes ⇒ 0% (exempt); else probe 12% → passes ⇒ 12%.
//
// Writes via Prisma updateMany so @updatedAt bumps → terminals pull the new rate on next
// products-sync (a raw SQL UPDATE would NOT bump updated_at and would never sync down).
//
// Run (reads DATABASE_URL + VCR_* from .env):
//   npx tsx scripts/backfill-vat-rate-regos.ts                 # DRY RUN — probes + prints plan
//   npx tsx scripts/backfill-vat-rate-regos.ts --apply         # writes resolved rates
//   npx tsx scripts/backfill-vat-rate-regos.ts --apply --all   # re-probe every product (not just NULL)
//
// VCR target comes from env (request test creds from REGOS: +998 55 501 00 30 / @regos_uzbot):
//   VCR_URL (default http://vcr-test.regos.uz), VCR_LOGIN (default cassir), VCR_PASSWORD (required)
// The VCR must be reachable from where this runs (test stand, or a customer machine's localhost).
// Filters via env: STORE_ID (default 1234; set ALL to ignore), CATEGORY_ID (default ALL).
//
// Idempotent (default touches vat_rate IS NULL only), sequential + rate-limited (VCR is
// single-threaded — one request at a time), resumable. Probes each distinct MXIK once and caches.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all'); // re-probe every product, not just vat_rate IS NULL
// Marked goods (beverages/dairy etc.) can't be VAT-probed — ValidateSale rejects them for a missing
// DataMatrix label before reaching the VAT check. They are VAT-able by default (exemptions are on
// non-marked staples, which the probe catches as 0%). Pass --marked-12 to write 12% for them;
// otherwise they're reported and left NULL for a manual decision.
const MARKED_12 = process.argv.includes('--marked-12');
const STORE_ID = process.env.STORE_ID === 'ALL' ? undefined : (process.env.STORE_ID ?? '1234');
const CATEGORY_ID =
  process.env.CATEGORY_ID && process.env.CATEGORY_ID !== 'ALL' ? Number(process.env.CATEGORY_ID) : undefined;
const DELAY_MS = 150; // pause between VCR calls; raise if throttled

const VCR_URL = process.env.VCR_URL ?? 'http://vcr-test.regos.uz';
const VCR_LOGIN = process.env.VCR_LOGIN ?? 'cassir';
const VCR_PASSWORD = process.env.VCR_PASSWORD ?? '';
const AUTH = Buffer.from(`${VCR_LOGIN}:${VCR_PASSWORD}`).toString('base64');

// Representative probe amount: 1000 sum = 100000 tiyin. ceil(amount*12/112) keeps the implied rate
// at ≥12.0000% so REGOS truncates it back to exactly 12 (a plain round lands at 11.99% → rejected).
const PROBE_AMOUNT = 100_000;
const VAT_12 = Math.ceil((PROBE_AMOUNT * 12) / (100 + 12));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let requestId = 1;
interface ValidateOutcome {
  ok: boolean;
  error?: number;
  desc?: string;
}

/** Receipt.ValidateSale a single-position receipt. No print, no fiscal effect — safe to spam.
 *  Retries a few times on network/timeout so one slow request can't abort the whole run. */
async function validateSale(mxik: string, vatValue: number, attempt = 0): Promise<ValidateOutcome> {
  const body = {
    id: requestId++,
    jsonrpc: '2.0',
    method: 'Receipt.ValidateSale',
    auth: AUTH,
    params: {
      receipt: {
        positions: [
          {
            name: 'vat-probe',
            barcode: mxik,
            icps: mxik,
            unit_name: 'шт',
            amount: PROBE_AMOUNT,
            quantity: 1000,
            vat_value: vatValue,
            discount: 0,
            owner_type: 'BuyingAndSelling',
          },
        ],
        payments: [{ type: 1, value: PROBE_AMOUNT }],
      },
      ignore_payments: true, // probing VAT only — don't let payment-sum checks interfere
    },
  };
  try {
    const res = await fetch(VCR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json()) as { ok: boolean; result: unknown };
    if (data.ok) return { ok: true };
    const err = data.result as { error: number; description: string };
    return { ok: false, error: err?.error, desc: err?.description };
  } catch (e) {
    if (attempt < 3) {
      await sleep(1000 * (attempt + 1));
      return validateSale(mxik, vatValue, attempt + 1);
    }
    return { ok: false, error: 0, desc: `network/timeout: ${e instanceof Error ? e.message : String(e)}` };
  }
}

type ProbeKind = 'exempt' | 'standard' | 'marked' | 'neterr' | 'bad';
interface ProbeResult {
  rate: 0 | 12 | null; // resolved rate to write, or null = don't write
  kind: ProbeKind;
  via: string;
}

/** Ask REGOS what VAT rate a MXIK is registered at. 0% if vat=0 validates; 12% if 12% validates.
 *  Marked goods (no DataMatrix) and ИКПУ/network errors can't be VAT-resolved → reported, not written
 *  (marked goods get 12% only with --marked-12). */
async function probeRate(mxik: string): Promise<ProbeResult> {
  const r0 = await validateSale(mxik, 0);
  if (r0.ok) return { rate: 0, kind: 'exempt', via: 'vat=0 OK → 0% (exempt)' };

  // Marked good: ValidateSale rejects for a missing marking code before it ever checks VAT, so we
  // can't probe its rate. They're VAT-able by default → 12% with --marked-12, else left NULL.
  if (r0.desc && /маркировк/i.test(r0.desc)) {
    return MARKED_12
      ? { rate: 12, kind: 'marked', via: 'marked good (unprobeable) → 12% (--marked-12)' }
      : { rate: null, kind: 'marked', via: 'marked good (unprobeable) — left NULL (use --marked-12)' };
  }
  // Network/timeout after retries — don't conclude anything.
  if (r0.error === 0) return { rate: null, kind: 'neterr', via: r0.desc ?? 'network error' };

  // vat=0 rejected with a VAT-rate error → the MXIK is VAT-able; confirm 12% validates.
  await sleep(DELAY_MS);
  if (r0.desc && /Ставка НДС/i.test(r0.desc)) {
    const r12 = await validateSale(mxik, VAT_12);
    if (r12.ok) return { rate: 12, kind: 'standard', via: 'vat=0 rejected, 12% OK → 12%' };
    if (r12.error === 0) return { rate: null, kind: 'neterr', via: r12.desc ?? 'network error' };
    return { rate: null, kind: 'bad', via: `12% also rejected: [${r12.error}] ${r12.desc}` };
  }
  return { rate: null, kind: 'bad', via: `undetermined (non-VAT error): [${r0.error}] ${r0.desc}` };
}

async function main() {
  if (!VCR_PASSWORD) {
    console.error('✗ VCR_PASSWORD is not set. Add it to .env or pass it inline.');
    process.exit(1);
  }

  const products = await prisma.product.findMany({
    where: {
      ...(STORE_ID ? { storeId: STORE_ID } : {}),
      ...(CATEGORY_ID !== undefined ? { categoryId: CATEGORY_ID } : {}),
      ...(ALL ? {} : { vatRate: null }),
    },
    select: { id: true, nameUz: true, mxik: true },
    orderBy: { id: 'asc' },
  });

  console.log(`\nVCR=${VCR_URL}  Store=${STORE_ID ?? 'ALL'}  Category=${CATEGORY_ID ?? 'ALL'}`);
  console.log(`${products.length} products (${ALL ? 'all' : 'vat_rate IS NULL'})`);
  console.log(APPLY ? '>>> APPLY — writing resolved rates\n' : '>>> DRY RUN — pass --apply to write\n');

  // Probe each distinct MXIK once, then fan the result out to every product sharing it.
  const cache = new Map<string, ProbeResult>();
  const byMxik = new Map<string, Array<{ id: number; nameUz: string }>>();
  const skipped: Array<{ id: number; nameUz: string; reason: string }> = [];

  for (const p of products) {
    if (!p.mxik || !/^[0-9]{17}$/.test(p.mxik)) {
      skipped.push({ id: p.id, nameUz: p.nameUz, reason: `bad/empty mxik (${p.mxik ?? 'null'})` });
      continue;
    }
    if (!byMxik.has(p.mxik)) byMxik.set(p.mxik, []);
    byMxik.get(p.mxik)!.push({ id: p.id, nameUz: p.nameUz });
  }

  console.log(`Distinct MXIKs to probe: ${byMxik.size}\n`);

  // products counted per outcome kind
  const counts: Record<ProbeKind, number> = { exempt: 0, standard: 0, marked: 0, neterr: 0, bad: 0 };
  let updated = 0;
  const review: string[] = [];

  let n = 0;
  for (const [mxik, rows] of byMxik) {
    let result = cache.get(mxik);
    if (!result) {
      result = await probeRate(mxik);
      cache.set(mxik, result);
      await sleep(DELAY_MS);
    }
    counts[result.kind] += rows.length;
    n++;
    // Progress every 50 MXIKs so a long background run shows life.
    if (n % 50 === 0) console.log(`… ${n}/${byMxik.size} MXIKs probed`);

    if (result.rate === null) {
      if (result.kind !== 'marked') {
        review.push(`  mxik=${mxik} (${rows.length} prod, e.g. "${rows[0].nameUz}") — ${result.via}`);
      }
      continue;
    }
    if (APPLY) {
      const res = await prisma.product.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { vatRate: result.rate },
      });
      updated += res.count;
    }
  }

  console.log(
    `\nDone. ${APPLY ? `Updated ${updated} products.` : 'Dry run — nothing written.'}\n` +
      `  0% exempt:        ${counts.exempt}\n` +
      `  12% standard:     ${counts.standard}\n` +
      `  marked goods:     ${counts.marked}  (${MARKED_12 ? 'written 12%' : 'left NULL — re-run with --marked-12'})\n` +
      `  network errors:   ${counts.neterr}  (transient — re-run to resolve)\n` +
      `  other/bad ИКПУ:   ${counts.bad}\n` +
      `  no valid MXIK:    ${skipped.length}  (cannot fiscalize until fixed)`,
  );
  if (review.length) {
    console.log('\nUndetermined non-marked (rate NOT written — bad ИКПУ / network):');
    for (const r of review.slice(0, 60)) console.log(r);
    if (review.length > 60) console.log(`  …and ${review.length - 60} more`);
  }
  if (skipped.length) {
    console.log('\nNo valid 17-digit MXIK (cannot fiscalize until fixed):');
    for (const s of skipped.slice(0, 50)) console.log(`  #${s.id} ${s.nameUz} — ${s.reason}`);
    if (skipped.length > 50) console.log(`  …and ${skipped.length - 50} more`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
