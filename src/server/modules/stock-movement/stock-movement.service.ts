import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * What produced a movement. Combined with `sourceId` this is the idempotency key, so the
 * values must stay stable — renaming one orphans every row already written under the old name.
 */
export const MovementSource = {
  ARRIVAL: 'ARRIVAL',
  SALE: 'SALE',
  COUNT: 'COUNT',
  SUPPLIER_TX: 'SUPPLIER_TX',
  OPENING: 'OPENING',
} as const;

export type MovementSourceType = (typeof MovementSource)[keyof typeof MovementSource];

type DecimalLike = Prisma.Decimal | number | string;

export interface MovementInput {
  storeId: string;
  productId: number;
  type: StockMovementType;
  /** SIGNED: positive adds to stock, negative removes. REVALUATION rows are 0. */
  quantity: DecimalLike;

  /**
   * Required, not optional, and deliberately so. The unique index that makes emission
   * idempotent is (source_type, source_id, product_id, type) — and in Postgres NULLs are
   * distinct, so a row with a null source would never collide with anything and the retry
   * protection would silently not apply. Making the API demand both means a caller cannot
   * accidentally opt out of it.
   */
  sourceType: MovementSourceType;
  sourceId: string;

  /** Cost and sale price at event time. Variance is valued from these, never from today's price. */
  unitCost?: DecimalLike | null;
  unitPrice?: DecimalLike | null;

  /** Absolute stock level after the event. Stocktake rows only — they are the only absolute writes. */
  balanceAfter?: DecimalLike | null;

  /** False when the event happened but stock was deliberately not moved (watermark case). */
  appliedToStock?: boolean;

  reasonCode?: string | null;
  note?: string | null;
  actorId?: string | null;
  actorName?: string | null;

  /** When it actually happened — NOT when it was recorded. Offline terminals upload old sales. */
  occurredAt: Date;
}

/**
 * Writes the append-only stock ledger.
 *
 * Every caller passes its own transaction client so the ledger row and the `Product.stock`
 * write it describes commit or roll back together. A ledger that can drift from stock is worse
 * than no ledger, because the reconciliation cross-check would then report phantom shrinkage.
 */
@Injectable()
export class StockMovementService {
  private readonly logger = new Logger(StockMovementService.name);

  /**
   * Emission is off until explicitly enabled, so the migration can ship, the code can deploy,
   * and the ledger can be switched on independently once the live store has been backed up.
   * Nothing reads the ledger yet, so flipping this off is a complete rollback.
   */
  readonly enabled = process.env.RECONCILIATION_LEDGER_ENABLED === 'true';

  constructor(private prisma: PrismaService) {}

  /**
   * Append rows inside the caller's transaction.
   *
   * `skipDuplicates` is what makes retries safe: sale sync already answers "Already synced" on
   * a duplicate receipt, the arrival import loop swallows per-row errors and re-runs, and the
   * OPENING seed is explicitly re-runnable. Without it one retry doubles a movement and
   * manufactures a variance indistinguishable from theft.
   */
  async emit(tx: Prisma.TransactionClient, rows: MovementInput[]): Promise<void> {
    if (!this.enabled || rows.length === 0) return;

    try {
      await tx.stockMovement.createMany({
        data: rows.map((r) => ({
          storeId: r.storeId,
          productId: r.productId,
          type: r.type,
          quantity: new Prisma.Decimal(r.quantity as never),
          unitCost: r.unitCost == null ? null : new Prisma.Decimal(r.unitCost as never),
          unitPrice: r.unitPrice == null ? null : new Prisma.Decimal(r.unitPrice as never),
          balanceAfter:
            r.balanceAfter == null ? null : new Prisma.Decimal(r.balanceAfter as never),
          appliedToStock: r.appliedToStock ?? true,
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          reasonCode: r.reasonCode ?? null,
          note: r.note ?? null,
          actorId: r.actorId ?? null,
          actorName: r.actorName ?? null,
          occurredAt: r.occurredAt,
        })),
        skipDuplicates: true,
      });
    } catch (err) {
      // Emission must never take down the operation it is observing. A sale that cannot be
      // rung up because the audit ledger hiccupped is a far worse failure than a gap in the
      // ledger — and the perpetual-vs-recomputed cross-check is designed to surface exactly
      // this kind of gap rather than let it pass as shrinkage.
      this.logger.error(
        `Failed to emit ${rows.length} stock movement(s): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Convenience for callers that are not already inside a transaction. */
  async emitStandalone(rows: MovementInput[]): Promise<void> {
    if (!this.enabled || rows.length === 0) return;
    await this.emit(this.prisma, rows);
  }
}
