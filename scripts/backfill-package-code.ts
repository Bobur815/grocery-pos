// Backfill products.package_code from the product's MXIK via tasnif.soliq.uz.
//
// package_code is the REGOS:VCR package/unit code for a product. It is derived from the
// product's 17-digit MXIK: GET tasnif integration-mxik/get/history/{mxik} → data.packageNames,
// then pick the single-unit package (mirrors src/shared/utils/mxik-packages.ts pickSingleUnitPackage).
// Required to fiscalize marked goods (group 022 etc.); harmless to fill for unmarked goods.
//
// Run (reads DATABASE_URL from .env — point it at the right DB):
//   npx tsx scripts/backfill-package-code.ts            # DRY RUN — prints plan, writes nothing
//   npx tsx scripts/backfill-package-code.ts --apply    # writes package_code
//
// Filters via env: STORE_ID (default 1234), CATEGORY_ID (default 1; set ALL to ignore category).
//   STORE_ID=1234 CATEGORY_ID=1   npx tsx scripts/backfill-package-code.ts --apply
//   STORE_ID=1234 CATEGORY_ID=ALL npx tsx scripts/backfill-package-code.ts --apply
//
// Idempotent (only touches package_code IS NULL), sequential + rate-limited (gentle on tasnif),
// resumable (safe to stop and re-run). This is a server/PG operation — no Electron rebuild needed.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';
const APPLY = process.argv.includes('--apply');
const STORE_ID = process.env.STORE_ID ?? '1234';
const CATEGORY_ID = process.env.CATEGORY_ID === 'ALL' ? undefined : Number(process.env.CATEGORY_ID ?? 1);
const DEFAULT_PIECE_CODE = '796'; // "dona / штука" — tasnif's piece unit; same default the product form uses
const DELAY_MS = 150; // pause between tasnif calls (~1 min for 439 rows); raise if throttled

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mirror of src/shared/utils/mxik-packages.ts pickSingleUnitPackage (inlined so the script
// needs no path-alias resolution). Smallest "=N" quantity wins; plain base unit (no "=") first.
function pickSingleUnit(
  pkgs: Array<{ code: string; name: string }>,
): { code: string; name: string } | undefined {
  if (pkgs.length === 0) return undefined;
  const qtyOf = (n: string) => {
    const m = n.match(/=\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 1;
  };
  const hasEq = (n: string) => (n.includes('=') ? 1 : 0);
  return [...pkgs].sort((a, b) => qtyOf(a.name) - qtyOf(b.name) || hasEq(a.name) - hasEq(b.name))[0];
}

async function fetchPackageCode(mxik: string): Promise<{ code: string; via: string }> {
  // 10s timeout — without it a single stalled request hangs the whole run.
  const res = await fetch(`${TASNIF}/integration-mxik/get/history/${mxik}`, {
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as {
    success?: boolean;
    data?: { packageNames?: Array<{ code: number; nameUz?: string; nameRu?: string }> };
  };
  const raw = json?.data?.packageNames ?? [];
  const pkgs = raw
    .map((p) => ({ code: String(p.code ?? ''), name: String(p.nameRu || p.nameUz || p.code || '') }))
    .filter((p) => p.code);
  const picked = pickSingleUnit(pkgs);
  return picked
    ? { code: picked.code, via: picked.name }
    : { code: DEFAULT_PIECE_CODE, via: 'default 796 (no packages)' };
}

async function main() {
  const products = await prisma.product.findMany({
    where: {
      storeId: STORE_ID,
      ...(CATEGORY_ID !== undefined ? { categoryId: CATEGORY_ID } : {}),
      packageCode: null,
    },
    select: { id: true, nameUz: true, mxik: true },
    orderBy: { id: 'asc' },
  });

  console.log(
    `\nStore=${STORE_ID} Category=${CATEGORY_ID ?? 'ALL'} — ${products.length} rows with NULL package_code`,
  );
  console.log(APPLY ? '>>> APPLY mode — writing changes\n' : '>>> DRY RUN — pass --apply to write\n');

  const skipped: Array<{ id: number; nameUz: string; reason: string }> = [];
  let updated = 0;

  for (const p of products) {
    if (!p.mxik || !/^[0-9]{17}$/.test(p.mxik)) {
      skipped.push({ id: p.id, nameUz: p.nameUz, reason: `bad/empty mxik (${p.mxik ?? 'null'})` });
      continue;
    }
    try {
      const { code, via } = await fetchPackageCode(p.mxik);
      console.log(`#${p.id} ${p.nameUz.slice(0, 32).padEnd(32)} mxik=${p.mxik} → ${code}  (${via})`);
      if (APPLY) {
        await prisma.product.update({ where: { id: p.id }, data: { packageCode: code } });
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
    `\nDone. ${APPLY ? `Updated ${updated}.` : 'Dry run — nothing written.'}  Skipped ${skipped.length}.`,
  );
  if (skipped.length) {
    console.log('\nSkipped (fix MXIK or investigate, then re-run):');
    for (const s of skipped) console.log(`  #${s.id} ${s.nameUz} — ${s.reason}`);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
