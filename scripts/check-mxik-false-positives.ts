// READ-ONLY: among products the group heuristic calls MARKED (MXIK starts 020/022), which does
// tasnif actually mark as PLAIN (label=0)? Those are the false positives — non-marked goods the POS
// wrongly forces to a QR scan. Deduped by MXIK to minimise tasnif calls. Run from a UZ IP.
//
//   npx tsx scripts/check-mxik-false-positives.ts [./products.json]
//   MAX=250 DELAY_MS=120 npx tsx scripts/check-mxik-false-positives.ts

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';
const LANG = process.env.LANG ?? 'uz_cyrl';
const DELAY_MS = Number(process.env.DELAY_MS ?? 150);
const MAX = Number(process.env.MAX ?? 250); // cap distinct MXIK lookups
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isHeuristicMarked = (m: string) => m.startsWith('020') || m.startsWith('022');
const normLabel = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

async function lookupLabel(code: string): Promise<{ label: number | null; found: boolean }> {
  try {
    const res = await fetch(`${TASNIF}/mxik/search/by-params?mxikCode=${code}&size=15&page=0&lang=${LANG}`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const j = (await res.json()) as { data?: { content?: Array<Record<string, unknown>> } };
      const row = j?.data?.content?.find((r) => r.mxikCode === code) ?? j?.data?.content?.[0];
      if (row) return { label: normLabel(row.label), found: true };
    }
  } catch { /* fall through */ }
  try {
    const res = await fetch(`${TASNIF}/elasticsearch/search?lang=${LANG}&search=${code}&size=20&page=0`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const j = (await res.json()) as { data?: Array<Record<string, unknown>> };
      const row = j?.data?.find((r) => r.mxikCode === code) ?? j?.data?.[0];
      if (row) return { label: normLabel(row.label), found: true };
    }
  } catch { /* not found */ }
  return { label: null, found: false };
}

async function main() {
  const file = path.resolve(process.argv[2] || process.env.PRODUCTS_JSON || 'products.json');
  const all = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim()) as Array<{ id: number; nameUz: string; mxik: string | null }>;

  const marked = all.filter((p) => typeof p.mxik === 'string' && /^\d{17}$/.test(p.mxik) && isHeuristicMarked(p.mxik));
  // Distinct MXIK → representative product, capped at MAX.
  const byMxik = new Map<string, { id: number; nameUz: string }>();
  for (const p of marked) if (!byMxik.has(p.mxik!)) byMxik.set(p.mxik!, { id: p.id, nameUz: p.nameUz });
  const codes = [...byMxik.keys()].slice(0, MAX);

  console.log(`\nHeuristic-MARKED products: ${marked.length} (${byMxik.size} distinct MXIK). Probing ${codes.length} (delay ${DELAY_MS}ms)…\n`);

  const falsePositives: string[] = [];
  const notFound: string[] = [];
  let plain = 0, markedCount = 0;

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const info = byMxik.get(code)!;
    const r = await lookupLabel(code);
    await sleep(DELAY_MS);
    if (!r.found) { notFound.push(`  ${code}  #${info.id}  "${info.nameUz.slice(0, 40)}"`); continue; }
    if (r.label === 1) { markedCount++; continue; }
    plain++;
    falsePositives.push(`  ${code}  label=${r.label}  #${info.id}  "${info.nameUz.slice(0, 45)}"`);
    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${codes.length} probed (${plain} false-positive, ${markedCount} confirmed marked)`);
  }

  console.log(`\n===== FALSE POSITIVES — heuristic=MARKED but tasnif label≠1 (${falsePositives.length}) =====`);
  for (const l of falsePositives) console.log(l);
  console.log(`\n===== NOT FOUND on tasnif (${notFound.length}) =====`);
  for (const l of notFound) console.log(l);
  console.log(`\nSummary of ${codes.length} distinct group-020/022 MXIK: ${markedCount} genuinely marked, ${plain} PLAIN (false positive), ${notFound.length} unknown to tasnif.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
