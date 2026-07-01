// READ-ONLY probe: does tasnif's `label` field correctly identify mandatory-marking (asl-belgisi)
// goods, and where does it disagree with the current group-prefix heuristic (isMarkedMxik = MXIK
// starts with 020/022)?
//
// tasnif.soliq.uz is geo-blocked to Uzbekistan IPs — run this from a UZ machine.
//
//   npx tsx scripts/check-mxik-label.ts            # first 20 products of ./products.json
//   LIMIT=50 npx tsx scripts/check-mxik-label.ts   # first 50
//   npx tsx scripts/check-mxik-label.ts ./products.json
//
// Writes nothing. Prints one line per product plus a disagreement summary.

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';
const LANG = process.env.LANG ?? 'uz_cyrl';
const DELAY_MS = Number(process.env.DELAY_MS ?? 200);
const LIMIT = Number(process.env.LIMIT ?? 20);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Current production heuristic (src/shared/utils/marking.ts) — kept inline so the probe is standalone.
const MARKING_GROUP_CODES = ['020', '022'];
const isMarkedMxik = (mxik?: string | null): boolean =>
  typeof mxik === 'string' && MARKING_GROUP_CODES.some((g) => mxik.startsWith(g));

interface ExportedRow {
  id: number;
  barcode: string;
  nameUz: string;
  mxik: string | null;
  categoryName: string;
}

// tasnif returns `label` as "0"/"1" (elasticsearch) or 0/1 (by-params). Normalise to a number.
function normLabel(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

interface LabelLookup {
  byParams: number | null;
  elastic: number | null;
  groupCode: string | null;
  found: boolean;
}

async function lookupLabel(code: string): Promise<LabelLookup> {
  const out: LabelLookup = { byParams: null, elastic: null, groupCode: null, found: false };

  try {
    const res = await fetch(
      `${TASNIF}/mxik/search/by-params?mxikCode=${code}&size=15&page=0&lang=${LANG}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { content?: Array<Record<string, unknown>> } };
      const row =
        json?.data?.content?.find((r) => r.mxikCode === code) ?? json?.data?.content?.[0];
      if (row) {
        out.found = true;
        out.byParams = normLabel(row.label);
        out.groupCode = row.groupCode != null ? String(row.groupCode) : null;
      }
    }
  } catch {
    /* fall through to elasticsearch */
  }

  try {
    const res = await fetch(
      `${TASNIF}/elasticsearch/search?lang=${LANG}&search=${code}&size=20&page=0`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const row = json?.data?.find((r) => r.mxikCode === code) ?? json?.data?.[0];
      if (row) {
        out.found = true;
        out.elastic = normLabel(row.label);
        if (!out.groupCode && row.groupCode != null) out.groupCode = String(row.groupCode);
      }
    }
  } catch {
    /* treat as not found */
  }

  return out;
}

async function main() {
  const file = path.resolve(process.argv[2] || process.env.PRODUCTS_JSON || 'products.json');
  if (!fs.existsSync(file)) throw new Error(`Products JSON not found: ${file}`);
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim();
  const all = JSON.parse(raw) as ExportedRow[];
  const products = all.slice(0, LIMIT);

  console.log(`\nSource: ${file} — probing first ${products.length} products (delay ${DELAY_MS}ms)\n`);
  console.log(
    'id     grp  heuristic  label(bp/es)  name'.padEnd(80) + '\n' + '─'.repeat(96),
  );

  const disagreements: string[] = [];
  const noMxik: string[] = [];

  for (const p of products) {
    const mxik = (p.mxik ?? '').trim();
    const name = (p.nameUz ?? '').slice(0, 40);

    if (!/^\d{17}$/.test(mxik)) {
      noMxik.push(`  #${p.id} "${name}" — mxik not 17-digit: "${mxik}"`);
      console.log(`${String(p.id).padEnd(6)} ---  ${'(no mxik)'.padEnd(10)} ${'—'.padEnd(13)} ${name}`);
      continue;
    }

    const heuristic = isMarkedMxik(mxik);
    const r = await lookupLabel(mxik);
    await sleep(DELAY_MS);

    const label = r.byParams ?? r.elastic; // by-params preferred, elasticsearch fallback
    const labelMarked = label === 1;
    const grp = mxik.slice(0, 3);
    const labelStr = `${r.byParams ?? '·'}/${r.elastic ?? '·'}`;

    // Flag where the group heuristic and the authoritative label disagree.
    let mark = ' ';
    if (r.found && label !== null && heuristic !== labelMarked) {
      mark = '‼';
      disagreements.push(
        `  #${p.id} grp=${grp} heuristic=${heuristic ? 'MARKED' : 'plain'} but label=${label} (${labelMarked ? 'MARKED' : 'plain'})  "${name}"`,
      );
    }
    if (!r.found) mark = '?';

    console.log(
      `${String(p.id).padEnd(6)} ${grp}  ${(heuristic ? 'MARKED' : 'plain').padEnd(10)} ${labelStr.padEnd(13)}${mark} ${name}`,
    );
  }

  console.log('\n' + '─'.repeat(96));
  console.log(`\nDisagreements (group heuristic ≠ tasnif label): ${disagreements.length}`);
  for (const d of disagreements) console.log(d);
  if (noMxik.length) {
    console.log(`\nSkipped (no valid 17-digit MXIK): ${noMxik.length}`);
    for (const n of noMxik) console.log(n);
  }
  console.log('\nLegend: label(bp/es) = tasnif `label` from by-params / elasticsearch. 1 = marked, 0 = plain.');
  console.log('  ‼ = heuristic disagrees with label   ? = tasnif has no record\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
