import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async findAll(storeId: string) {
    return this.prisma.category.findMany({
      where: { storeId, active: true },
      orderBy: { nameRu: 'asc' },
    });
  }

  async create(storeId: string, data: { nameRu: string; nameUz: string; mxikGroupCode?: string | null }) {
    return this.prisma.category.create({
      data: { storeId, nameRu: data.nameRu, nameUz: data.nameUz, mxikGroupCode: data.mxikGroupCode ?? null },
    });
  }

  async update(id: number, storeId: string, data: { nameRu?: string; nameUz?: string; mxikGroupCode?: string | null }) {
    await this.findById(id, storeId);
    return this.prisma.category.update({
      where: { id },
      data: { ...data },
    });
  }

  async delete(id: number, storeId: string) {
    await this.findById(id, storeId);
    await this.prisma.category.update({
      where: { id },
      data: { active: false },
    });
    return { success: true };
  }

  async syncBulk(storeId: string, categories: Array<{ nameUz: string; nameRu: string; active?: boolean; mxikGroupCode?: string | null }>) {
    let created = 0, skipped = 0, errors = 0;

    // Match incoming categories on a normalized `nameUz` ONLY — not exact nameRu+nameUz.
    // The old both-names match spawned a brand-new category on every upload whenever a
    // terminal's Russian translation drifted even slightly (or had stray whitespace/case),
    // and an admin renaming the duplicate destroyed the match target so the next sync
    // created yet another one (the "category bounce-back" loop). Keying on nameUz mirrors
    // the download path in products-sync.ts (syncCategories matches by nameUz) so the two
    // sync directions stay consistent. Categories are few, so one findMany + in-memory
    // match is cheaper than a query per row.
    const existingCategories = await this.prisma.category.findMany({ where: { storeId } });
    const normalize = (s: string) => s.trim().toLowerCase();
    const byNameUz = new Map<string, { id: number; nameUz: string }>();
    for (const e of existingCategories) {
      // First write wins so we attach to the lowest/canonical id on collisions.
      if (!byNameUz.has(normalize(e.nameUz))) byNameUz.set(normalize(e.nameUz), e);
    }

    for (const c of categories) {
      try {
        const existing = byNameUz.get(normalize(c.nameUz));
        if (existing) {
          // VPS is the source of truth for category master data — a terminal must NEVER overwrite
          // an existing category (active, names, mxik_group_code). active was previously updated
          // here, which let a terminal revert a web-admin deactivation; mxik_group_code was already
          // shielded. Existing categories only flow DOWN to terminals via syncCategories; terminals
          // may only CREATE brand-new offline categories (the else branch below).
          skipped++;
        } else {
          // New terminal-originated category: leave mxik_group_code null for an admin to map.
          const newCat = await this.prisma.category.create({
            data: { storeId, nameUz: c.nameUz, nameRu: c.nameRu, active: c.active ?? true },
          });
          // Register it so a second incoming row with the same nameUz in this same batch
          // updates rather than creating another duplicate.
          byNameUz.set(normalize(newCat.nameUz), newCat);
          created++;
        }
      } catch {
        errors++;
      }
    }
    return { created, skipped, errors };
  }

  private async findById(id: number, storeId: string) {
    const category = await this.prisma.category.findFirst({
      where: { id, storeId },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }
}
