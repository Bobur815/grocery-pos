#!/usr/bin/env node
/**
 * Backfill Product.isMarked from tasnif.soliq.uz's per-product `label` field (1 = mandatory
 * marking / Asl-Belgisi, 0 = plain). This replaces the imprecise MXIK group-prefix heuristic
 * (isMarkedMxik = 020/022) which is wrong in both directions — see scripts/check-mxik-label.ts.
 *
 * tasnif.soliq.uz is geo-blocked to Uzbekistan IPs and the production VPS is in Germany, so this
 * must run from a UZ machine. Point DATABASE_URL at the VPS Postgres over an SSH tunnel:
 *
 *   1. Open the tunnel (port 5433 avoids a local-postgres clash):
 *        ssh -L 5433:localhost:5432 contabo
 *
 *   2. STAGING first, then production:
 *        DATABASE_URL="postgresql://postgres:PASS@localhost:5433/posgro_staging" \
 *          npx tsx scripts/backfill-is-marked.ts
 *        DATABASE_URL="postgresql://postgres:PASS@localhost:5433/posgro" \
 *          npx tsx scripts/backfill-is-marked.ts
 *
 * Idempotent — re-running only re-confirms values. Dedupes distinct MXIK so each code costs one
 * tasnif call, then UPDATEs every product sharing that code. Products whose MXIK is not 17 digits,
 * or that tasnif doesn't know, are left is_marked = NULL (the POS then falls back to the heuristic).
 *
 * Tunables (env):
 *   STORE_ID    limit to one store (default ALL stores)
 *   ONLY_NULL   'true' to only touch products whose is_marked is still NULL (default false → all)
 *   DELAY_MS    pause between tasnif calls (default 200; raise if throttled)
 *   LANG        tasnif language (default uz_cyrl)
 *   DRY_RUN     'true' to compute + report without writing
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const TASNIF = 'https://tasnif.soliq.uz/api/cls-api';
const LANG = process.env.LANG ?? 'uz_cyrl';
const DELAY_MS = Number(process.env.DELAY_MS ?? 200);
const DRY_RUN = process.env.DRY_RUN === 'true';
const ONLY_NULL = process.env.ONLY_NULL === 'true';
const STORE_ID = process.env.STORE_ID;

const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** tasnif `label` → boolean (1 = marked, 0 = plain). Null when absent/unparseable. */
function readLabel(row: { label?: unknown } | undefined): boolean | null {
  if (!row || row.label === null || row.label === undefined || row.label === '') return null;
  return Number(row.label) === 1;
}

/**
 * Resolve a 17-digit MXIK's marking flag from tasnif. by-params first (authoritative `label`),
 * elasticsearch as a fallback so one endpoint's quirk doesn't yield a false null.
 */
async function lookupIsMarked(code: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `${TASNIF}/mxik/search/by-params?mxikCode=${code}&size=15&page=0&lang=${LANG}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { content?: Array<{ mxikCode?: string; label?: unknown }> } };
      const row = json?.data?.content?.find((r) => r.mxikCode === code) ?? json?.data?.content?.[0];
      const label = readLabel(row);
      if (label !== null) return label;
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
      const json = (await res.json()) as { data?: Array<{ mxikCode?: string; label?: unknown }> };
      const row = json?.data?.find((r) => r.mxikCode === code) ?? json?.data?.[0];
      return readLabel(row);
    }
  } catch {
    // treat as unknown
  }
  return null;
}

async function main() {
  const where: Record<string, unknown> = {};
  if (STORE_ID) where.storeId = STORE_ID;
  if (ONLY_NULL) where.isMarked = null;

  const products = await prisma.product.findMany({
    where,
    select: { mxik: true },
  });

  // Distinct valid 17-digit MXIK codes.
  const codes = [
    ...new Set(
      products
        .map((p) => (p.mxik ?? '').trim())
        .filter((m) => /^\d{17}$/.test(m)),
    ),
  ];

  console.log(
    `\n${DRY_RUN ? '[DRY RUN] ' : ''}Backfilling is_marked` +
      `${STORE_ID ? ` for store ${STORE_ID}` : ' (all stores)'}` +
      `${ONLY_NULL ? ', only NULL rows' : ''}.` +
      `\n${products.length} products, ${codes.length} distinct 17-digit MXIK to resolve (delay ${DELAY_MS}ms).\n`,
  );

  let marked = 0; // codes tasnif says are marked
  let plain = 0; // codes tasnif says are plain
  let unknown = 0; // codes tasnif has no label for → left NULL
  let rowsUpdated = 0;
  let i = 0;

  for (const code of codes) {
    i++;
    const isMarked = await lookupIsMarked(code);
    await sleep(DELAY_MS);

    if (isMarked === null) {
      unknown++;
    } else {
      if (isMarked) marked++;
      else plain++;
      if (!DRY_RUN) {
        const r = await prisma.product.updateMany({
          where: { mxik: code, ...(STORE_ID ? { storeId: STORE_ID } : {}) },
          data: { isMarked },
        });
        rowsUpdated += r.count;
      }
    }

    if (i % 50 === 0) {
      console.log(
        `  …${i}/${codes.length} codes (marked ${marked}, plain ${plain}, unknown ${unknown}, rows updated ${rowsUpdated})`,
      );
    }
  }

  console.log(
    `\nDone. ${codes.length} distinct MXIK resolved:` +
      `\n  marked  : ${marked}` +
      `\n  plain   : ${plain}` +
      `\n  unknown : ${unknown} (left is_marked = NULL → POS heuristic fallback)` +
      `\n  product rows updated: ${rowsUpdated}${DRY_RUN ? ' (DRY RUN — nothing written)' : ''}\n`,
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect().finally(() => process.exit(1));
});
