import type { Prisma } from '../../generated/prisma-sqlite';
import { getPrismaNamespace } from '../database/sqlite-client';

/**
 * What completing a stocktake does to each line.
 *
 * A port of `planCompletion()` in `src/server/modules/inventory-count/inventory-count.service.ts`.
 * It could not be imported: that module pulls in NestJS and the PostgreSQL Prisma client, neither
 * of which belongs in the Electron main bundle. Kept pure and separately tested for the same
 * reason the original is — the write-off rules are where the money is, and they are easy to get
 * subtly wrong.
 */

export interface PlannableItem {
  id: string;
  productId: number;
  expectedQty: Prisma.Decimal | string | number;
  cost: Prisma.Decimal | string | number | null;
  countedQty: Prisma.Decimal | string | number | null;
  counted: boolean;
}

export interface CompletionLine {
  itemId: string;
  productId: number;
  countedQty: string;
  difference: string;
  writtenOff: boolean;
}

export interface CompletionPlan {
  rows: CompletionLine[];
  countedItems: number;
  writtenOffItems: number;
  totalDifference: Prisma.Decimal;
  totalValueDiff: Prisma.Decimal;
  writeOffValue: Prisma.Decimal;
}

/**
 * `false` writes nothing off, `true` writes off every eligible line, and a set writes off only
 * the named ones. The dashboard's explicit list wins over the blanket flag when it sends both.
 */
export type WriteOffSelection = boolean | Set<string>;

export function planCompletion(
  items: readonly PlannableItem[],
  writeOff: WriteOffSelection,
): CompletionPlan {
  const { Decimal } = getPrismaNamespace();
  let totalDifference = new Decimal(0);
  let totalValueDiff = new Decimal(0);
  let writeOffValue = new Decimal(0);

  const buildRow = (
    item: PlannableItem,
    resultingQty: Prisma.Decimal,
    writtenOff: boolean,
  ): CompletionLine => {
    const difference = resultingQty.minus(new Decimal(item.expectedQty as never));
    totalDifference = totalDifference.plus(difference);
    if (item.cost !== null && item.cost !== undefined) {
      const value = difference.times(new Decimal(item.cost as never));
      totalValueDiff = totalValueDiff.plus(value);
      if (writtenOff) writeOffValue = writeOffValue.plus(value);
    }
    return {
      itemId: item.id,
      productId: item.productId,
      countedQty: resultingQty.toString(),
      difference: difference.toString(),
      writtenOff,
    };
  };

  const counted = items.filter((i) => i.counted && i.countedQty !== null);

  // Only lines nobody touched, and only where stock was expected. A line already expected at
  // zero has nothing to write off, so offering it would just inflate the write-off count.
  const eligible = items.filter(
    (i) => !i.counted && new Decimal(i.expectedQty as never).gt(0),
  );

  const toWriteOff =
    writeOff === false
      ? []
      : writeOff === true
        ? eligible
        : // Intersection, not lookup: an id that is not an eligible uncounted line of this
          // document is ignored rather than trusted, so a stale page cannot zero a line
          // somebody has since counted.
          eligible.filter((i) => writeOff.has(i.id));

  const rows = [
    ...counted.map((item) =>
      buildRow(item, new Decimal(item.countedQty as never), false),
    ),
    ...toWriteOff.map((item) => buildRow(item, new Decimal(0), true)),
  ];

  return {
    rows,
    countedItems: counted.length,
    writtenOffItems: toWriteOff.length,
    totalDifference,
    totalValueDiff,
    writeOffValue,
  };
}
