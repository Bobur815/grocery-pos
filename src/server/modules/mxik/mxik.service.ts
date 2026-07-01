import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EXCLUDED_MXIK_GROUPS } from '@shared/types/mxik.types';
import type { CatalogEntry, MxikGroup } from '@shared/types/mxik.types';

const TASNIF_BASE = 'https://tasnif.soliq.uz/api/cls-api';

interface MxikCodeResponse {
  success: boolean;
  data: {
    mxikCode: string;
    brandName: string | null;
    attributeNameUz: string | null;
    attributeNameRu: string | null;
    subPositionNameUz: string;
    subPositionNameRu: string;
    packageNames: Array<{ code: number; nameUz: string }>;
  } | null;
}

interface MxikSearchResponse {
  success: boolean;
  data: Array<{
    mxikCode: string;
    internationalCode: string;
  }> | null;
  recordTotal: number;
}

const CATALOG_SELECT = {
  mxikCode: true, mxikName: true,
  groupCode: true, groupName: true,
  classCode: true, className: true,
  internationalCode: true, unitName: true,
} as const;

@Injectable()
export class MxikService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Local catalog endpoints ───────────────────────────────────────────────

  /**
   * Distinct MXIK groups (code + name) for the category picker.
   * Deduplicates by groupCode (catalog has transliteration variants of the same
   * code) keeping the name variant with the most rows, and drops groups the store
   * is legally not allowed to sell (EXCLUDED_MXIK_GROUPS).
   */
  async catalogGroups(): Promise<MxikGroup[]> {
    const raw = await this.prisma.mxikCatalog.groupBy({
      by: ['groupCode', 'groupName'],
      _count: { mxikCode: true },
    });

    const byCode = new Map<string, { groupName: string; count: number }>();
    for (const g of raw) {
      if (EXCLUDED_MXIK_GROUPS.has(g.groupCode)) continue;
      const existing = byCode.get(g.groupCode);
      if (!existing || g._count.mxikCode > existing.count) {
        byCode.set(g.groupCode, { groupName: g.groupName, count: g._count.mxikCode });
      }
    }

    return [...byCode.entries()]
      .map(([groupCode, { groupName }]) => ({ groupCode, groupName }))
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode));
  }

  async catalogLookupByBarcode(barcode: string): Promise<CatalogEntry | null> {
    return this.prisma.mxikCatalog.findFirst({
      where: { internationalCode: barcode },
      select: CATALOG_SELECT,
    });
  }

  async catalogSearch(q: string, limit = 20): Promise<CatalogEntry[]> {
    if (!q || q.trim().length < 2) return [];
    return this.prisma.mxikCatalog.findMany({
      where: {
        OR: [
          { mxikName:      { contains: q, mode: 'insensitive' } },
          { className:     { contains: q, mode: 'insensitive' } },
          { subPositionName: { contains: q, mode: 'insensitive' } },
          { brandName:     { contains: q, mode: 'insensitive' } },
        ],
      },
      select: CATALOG_SELECT,
      take: limit,
      orderBy: { mxikCode: 'asc' },
    });
  }
  /**
   * Resolve a 17-digit MXIK's mandatory-marking flag from tasnif's `label` field (1 = marked,
   * 0 = plain). The `integration-mxik/get/history` endpoint does NOT return `label`, so query the
   * `by-params` endpoint (elasticsearch fallback). Returns null when tasnif has no usable label —
   * the caller then leaves Product.isMarked null and the POS falls back to the group heuristic.
   */
  async getIsMarked(code: string): Promise<boolean | null> {
    const readLabel = (row: { label?: unknown } | undefined): boolean | null => {
      if (!row || row.label === null || row.label === undefined || row.label === '') return null;
      return Number(row.label) === 1;
    };
    try {
      const res = await fetch(`${TASNIF_BASE}/mxik/search/by-params?mxikCode=${code}&size=15&page=0&lang=uz_cyrl`);
      if (res.ok) {
        const j = await res.json() as { data?: { content?: Array<{ mxikCode?: string; label?: unknown }> } };
        const row = j?.data?.content?.find((r) => r.mxikCode === code) ?? j?.data?.content?.[0];
        const label = readLabel(row);
        if (label !== null) return label;
      }
    } catch {
      // fall through to elasticsearch
    }
    try {
      const res = await fetch(`${TASNIF_BASE}/elasticsearch/search?lang=uz_cyrl&search=${code}&size=20&page=0`);
      if (res.ok) {
        const j = await res.json() as { data?: Array<{ mxikCode?: string; label?: unknown }> };
        const row = j?.data?.find((r) => r.mxikCode === code) ?? j?.data?.[0];
        return readLabel(row);
      }
    } catch {
      // treat as unknown
    }
    return null;
  }

  async getByCode(code: string): Promise<{ code: string; name: string; nameRu: string; packageCode: string; isMarked: boolean | null }> {
    if (!/^\d{17}$/.test(code)) {
      throw new HttpException('Invalid MXIK code — must be 17 digits', HttpStatus.BAD_REQUEST);
    }

    let json: MxikCodeResponse;
    try {
      const res = await fetch(`${TASNIF_BASE}/integration-mxik/get/history/${code}`);
      json = await res.json() as MxikCodeResponse;
    } catch {
      throw new HttpException('MXIK service unavailable', HttpStatus.BAD_GATEWAY);
    }

    if (!json.success || !json.data) {
      throw new HttpException('MXIK code not found', HttpStatus.NOT_FOUND);
    }

    const d = json.data;
    const brand = d.brandName ? `${d.brandName} ` : '';
    return {
      code: d.mxikCode,
      name: brand + (d.attributeNameUz ?? d.subPositionNameUz),
      nameRu: brand + (d.attributeNameRu ?? d.subPositionNameRu),
      packageCode: String(d.packageNames?.[0]?.code ?? '796'),
      isMarked: await this.getIsMarked(d.mxikCode),
    };
  }

  async searchByBarcode(barcode: string): Promise<{ code: string; name: string; nameRu: string; packageCode: string; isMarked: boolean | null }> {
    let json: MxikSearchResponse;
    try {
      const url = `${TASNIF_BASE}/elasticsearch/search?lang=uz_cyrl&search=${encodeURIComponent(barcode)}&size=5&page=0`;
      const res = await fetch(url);
      json = await res.json() as MxikSearchResponse;
    } catch {
      throw new HttpException('MXIK service unavailable', HttpStatus.BAD_GATEWAY);
    }

    if (!json.success || !json.data?.length) {
      throw new HttpException('Product not found in MXIK registry', HttpStatus.NOT_FOUND);
    }

    const match = json.data.find((d) => d.internationalCode === barcode) ?? json.data[0];
    return this.getByCode(match.mxikCode);
  }
}
