// Audit each product's MXIK against tasnif.soliq.uz and report two problems:
//
//   1. INCORRECT MXIK  — the product's 17-digit MXIK is not a valid format, or tasnif has no
//                        record of it (the code was mistyped / belongs to nothing real).
//   2. GROUP MISMATCH  — tasnif's authoritative `groupCode` for the product's MXIK is NOT one of
//                        the codes in the product's category.mxik_group_code. The product is filed
//                        under the wrong category for what it actually is.
//
// READ-ONLY — it writes nothing to any database. It prints both lists and also dumps a CSV
// (mxik-check-report.csv) + JSON (mxik-check-report.json) next to where you run it.
//
// WHY A JSON FILE: tasnif.soliq.uz is geo-blocked to Uzbekistan IPs and the production VPS is in
// Germany, so the audit can't run there. Instead, export the products to JSON on the VPS
// (scripts/export-products-for-mxik-check.sql), copy products.json to a PC on a UZ IP, and run
// this script there against that file:
//
//   PRODUCTS_JSON=products.json npm run check:mxik
//   # or just `npm run check:mxik` if the file is named products.json in the current folder
//   # or pass the path:  npx tsx scripts/check-mxik-group-codes.ts ./products.json
//
// FALLBACK (DB mode, only when running from inside Uzbekistan with DB access): if no JSON file is
// given/found, it queries PostgreSQL directly via DATABASE_URL (STORE_ID, ACTIVE_ONLY envs apply).
//
// Tunables (env):
//   PRODUCTS_JSON    path to the exported products JSON (default ./products.json if present)
//   INCLUDE_NO_MXIK  'true' to also list products that have no MXIK at all (default false)
//   DELAY_MS         pause between tasnif calls (default 200; raise if throttled)
//   LANG             tasnif language (default uz_cyrl)
//   STORE_ID         DB-mode only: store to audit (default 1234; ALL = every store)
//   ACTIVE_ONLY      DB-mode only: 'false' to include inactive products (default true)
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';

const INCLUDE_NO_MXIK = process.env.INCLUDE_NO_MXIK === 'true';
const DELAY_MS = Number(process.env.DELAY_MS ?? 200);
const LANG = process.env.LANG ?? 'uz_cyrl';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Normalised shape the audit works on, regardless of whether it came from JSON or the DB.
interface ProductRow {
  id: number;
  barcode: string;
  name: string;
  mxik: string | null;
  categoryName: string;
  categoryGroups: string; // category.mxik_group_code as stored (comma-separated)
  storeProductCode: number | null;
}

type TasnifLookup = { ok: true; groupCode: string } | { ok: false };

interface TasnifRow {
  mxikCode?: string;
  groupCode?: string;
}

/**
 * Resolve a 17-digit MXIK to its authoritative groupCode via tasnif. Tries the exact by-params
 * lookup first, then falls back to elasticsearch (matching the exact mxikCode) so a quirk in one
 * endpoint doesn't produce a false "not found". Returns { ok:false } only when neither knows it.
 */
async function lookupGroupCode(code: string): Promise<TasnifLookup> {
  try {
    const res = await fetch(
      `${TASNIF}/mxik/search/by-params?mxikCode=${code}&size=15&page=0&lang=${LANG}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { content?: TasnifRow[] } };
      const row = json?.data?.content?.find((r) => r.mxikCode === code) ?? json?.data?.content?.[0];
      if (row?.groupCode) return { ok: true, groupCode: String(row.groupCode) };
    }
  } catch {
    // fall through to elasticsearch
  }

  try {
    const res = await fetch(
      `${TASNIF}/elasticsearch/search?lang=${LANG}&search=${code}&size=20&page=0`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: TasnifRow[] };
      const row = json?.data?.find((r) => r.mxikCode === code);
      if (row?.groupCode) return { ok: true, groupCode: String(row.groupCode) };
    }
  } catch {
    // treat as not found
  }
  return { ok: false };
}

function splitGroups(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

// ── Data sources ──────────────────────────────────────────────────────────────

/** The exported JSON's row shape (keys come straight from the SQL column aliases). */
interface ExportedRow {
  id: number;
  barcode: string;
  nameUz: string;
  mxik: string | null;
  storeProductCode: number | null;
  categoryName: string;
  categoryMxikGroupCode: string | null;
}

function loadFromJson(file: string): ProductRow[] {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON array (got ${typeof parsed})`);
  }
  return (parsed as ExportedRow[]).map((r) => ({
    id: r.id,
    barcode: r.barcode ?? '',
    name: r.nameUz ?? '',
    mxik: r.mxik ?? null,
    categoryName: r.categoryName ?? `#?`,
    categoryGroups: r.categoryMxikGroupCode ?? '',
    storeProductCode: r.storeProductCode ?? null,
  }));
}

async function loadFromDb(): Promise<ProductRow[]> {
  // Imported lazily so JSON-mode runs don't need a generated Prisma client / DB connection.
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const STORE_ID = process.env.STORE_ID ?? '1234';
  const STORE_ALL = STORE_ID.toUpperCase() === 'ALL';
  const ACTIVE_ONLY = process.env.ACTIVE_ONLY !== 'false';
  try {
    const products = await prisma.product.findMany({
      where: {
        ...(STORE_ALL ? {} : { storeId: STORE_ID }),
        ...(ACTIVE_ONLY ? { active: true } : {}),
      },
      select: {
        id: true,
        barcode: true,
        nameUz: true,
        nameRu: true,
        mxik: true,
        categoryId: true,
        storeProductCode: true,
        category: { select: { nameRu: true, mxikGroupCode: true } },
      },
      orderBy: { id: 'asc' },
    });
    return products.map((p) => ({
      id: p.id,
      barcode: p.barcode,
      name: p.nameUz || p.nameRu,
      mxik: p.mxik,
      categoryName: p.category?.nameRu ?? `#${p.categoryId}`,
      categoryGroups: p.category?.mxikGroupCode ?? '',
      storeProductCode: p.storeProductCode ?? null,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

/** Pick the source: explicit JSON path (arg/env) → default ./products.json → DB fallback. */
async function loadProducts(): Promise<{ rows: ProductRow[]; source: string }> {
  const argPath = process.argv[2];
  const envPath = process.env.PRODUCTS_JSON;
  const defaultPath = path.resolve(process.cwd(), 'products.json');
  const jsonPath = argPath || envPath || (fs.existsSync(defaultPath) ? defaultPath : null);

  if (jsonPath) {
    const resolved = path.resolve(jsonPath);
    if (!fs.existsSync(resolved)) throw new Error(`Products JSON not found: ${resolved}`);
    return { rows: loadFromJson(resolved), source: `JSON ${resolved}` };
  }
  return { rows: await loadFromDb(), source: `DB (store ${process.env.STORE_ID ?? '1234'})` };
}

// ── Report types ────────────────────────────────────────────────────────────

type Reason = 'BAD_FORMAT' | 'NOT_FOUND' | 'GROUP_MISMATCH' | 'NO_MXIK';

interface Flagged extends ProductRow {
  tasnifGroupCode: string; // '' when not applicable
  reason: Reason;
}

function csvCell(v: string | number | null): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const { rows: products, source } = await loadProducts();
  console.log(`\nSource: ${source} — ${products.length} products to audit (delay ${DELAY_MS}ms)\n`);

  // Cache tasnif lookups per MXIK — many products share a code, so this collapses the API calls.
  const cache = new Map<string, TasnifLookup>();
  const flagged: Flagged[] = [];
  let checked = 0;
  let apiCalls = 0;

  for (const p of products) {
    const allowed = splitGroups(p.categoryGroups);
    const mxik = (p.mxik ?? '').trim();
    const push = (reason: Reason, tasnifGroupCode = '') =>
      flagged.push({ ...p, mxik, tasnifGroupCode, reason });

    if (!mxik) {
      if (INCLUDE_NO_MXIK) push('NO_MXIK');
      continue;
    }
    if (!/^\d{17}$/.test(mxik)) {
      push('BAD_FORMAT'); // cheap local check before spending an API call
      continue;
    }

    let result = cache.get(mxik);
    if (!result) {
      result = await lookupGroupCode(mxik);
      cache.set(mxik, result);
      apiCalls++;
      await sleep(DELAY_MS);
    }
    checked++;

    if (!result.ok) {
      push('NOT_FOUND');
    } else if (!allowed.includes(result.groupCode)) {
      push('GROUP_MISMATCH', result.groupCode);
    }

    if (checked % 50 === 0) {
      console.log(`  …${checked} checked (${apiCalls} tasnif calls, ${flagged.length} flagged)`);
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const incorrect = flagged.filter((f) => f.reason === 'BAD_FORMAT' || f.reason === 'NOT_FOUND');
  const mismatch = flagged.filter((f) => f.reason === 'GROUP_MISMATCH');
  const noMxik = flagged.filter((f) => f.reason === 'NO_MXIK');

  const line = (f: Flagged) =>
    `  #${f.id} code=${String(f.storeProductCode ?? '—').padEnd(6)} ${f.name.slice(0, 38).padEnd(38)} bc=${f.barcode.padEnd(13)} mxik=${(f.mxik || '—').padEnd(17)} cat="${f.categoryName}" [${f.categoryGroups || '—'}]` +
    (f.tasnifGroupCode ? ` → tasnifGroup=${f.tasnifGroupCode}` : '');

  console.log(`\n===== INCORRECT MXIK (${incorrect.length}) =====`);
  console.log('  (bad 17-digit format, or tasnif has no record of the code)');
  for (const f of incorrect) console.log(line(f));

  console.log(`\n===== GROUP MISMATCH (${mismatch.length}) =====`);
  console.log("  (tasnif's groupCode is NOT in the product category's mxik_group_code)");
  for (const f of mismatch) console.log(line(f));

  if (INCLUDE_NO_MXIK) {
    console.log(`\n===== NO MXIK (${noMxik.length}) =====`);
    for (const f of noMxik) console.log(line(f));
  }

  // ── Files ─────────────────────────────────────────────────────────────────
  const header = [
    'reason',
    'productId',
    'storeProductCode',
    'name',
    'barcode',
    'mxik',
    'categoryName',
    'categoryGroups',
    'tasnifGroupCode',
  ];
  const csvRows = flagged.map((f) =>
    [f.reason, f.id, f.storeProductCode ?? '', f.name, f.barcode, f.mxik, f.categoryName, f.categoryGroups, f.tasnifGroupCode]
      .map(csvCell)
      .join(','),
  );
  const csvPath = path.resolve(process.cwd(), 'mxik-check-report.csv');
  const jsonPath = path.resolve(process.cwd(), 'mxik-check-report.json');
  fs.writeFileSync(csvPath, '﻿' + [header.join(','), ...csvRows].join('\n'), 'utf8'); // BOM for Excel/Cyrillic
  fs.writeFileSync(jsonPath, JSON.stringify(flagged, null, 2), 'utf8');

  console.log(
    `\nDone. ${products.length} products, ${apiCalls} tasnif calls (${cache.size} distinct MXIK).` +
      `\n  Incorrect MXIK: ${incorrect.length} · Group mismatch: ${mismatch.length}` +
      (INCLUDE_NO_MXIK ? ` · No MXIK: ${noMxik.length}` : '') +
      `\nReports written:\n  ${csvPath}\n  ${jsonPath}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
