import { Prisma } from '@prisma/client';
import { planCompletion } from './inventory-count.service';

type Line = Parameters<typeof planCompletion>[0][number];

let seq = 0;
function line(over: {
  counted?: boolean;
  countedQty?: number | null;
  expectedQty: number;
  cost?: number | null;
}): Line {
  seq += 1;
  return {
    id: `item-${seq}`,
    productId: seq,
    counted: over.counted ?? false,
    countedQty:
      over.countedQty === undefined || over.countedQty === null
        ? null
        : new Prisma.Decimal(over.countedQty),
    expectedQty: new Prisma.Decimal(over.expectedQty),
    cost: over.cost === undefined || over.cost === null ? null : new Prisma.Decimal(over.cost),
  };
}

const byId = (plan: ReturnType<typeof planCompletion>, id: string) =>
  plan.rows.find((r) => r.itemId === id);

describe('planCompletion', () => {
  describe('without write-off (default)', () => {
    it('applies counted lines only and leaves uncounted ones out entirely', () => {
      const counted = line({ counted: true, countedQty: 8, expectedQty: 10, cost: 1000 });
      const untouched = line({ expectedQty: 5, cost: 500 });

      const plan = planCompletion([counted, untouched], false);

      expect(plan.rows).toHaveLength(1);
      expect(byId(plan, counted.id)).toMatchObject({
        countedQty: '8',
        difference: '-2',
        writtenOff: false,
      });
      // The uncounted line must not appear at all — no stock write is emitted for it.
      expect(byId(plan, untouched.id)).toBeUndefined();
      expect(plan.writtenOffItems).toBe(0);
      expect(plan.writeOffValue.toString()).toBe('0');
      expect(plan.totalValueDiff.toString()).toBe('-2000');
    });

    it('treats a counted zero as a real count, not a write-off', () => {
      const zero = line({ counted: true, countedQty: 0, expectedQty: 4, cost: 250 });

      const plan = planCompletion([zero], false);

      expect(byId(plan, zero.id)).toMatchObject({ countedQty: '0', writtenOff: false });
      expect(plan.countedItems).toBe(1);
      expect(plan.writtenOffItems).toBe(0);
      expect(plan.totalValueDiff.toString()).toBe('-1000');
    });
  });

  describe('with write-off', () => {
    it('zeroes uncounted lines and records them separately from counted ones', () => {
      const counted = line({ counted: true, countedQty: 8, expectedQty: 10, cost: 1000 });
      const missing = line({ expectedQty: 3, cost: 2000 });

      const plan = planCompletion([counted, missing], true);

      expect(plan.rows).toHaveLength(2);
      expect(byId(plan, missing.id)).toMatchObject({
        countedQty: '0',
        difference: '-3',
        writtenOff: true,
      });
      expect(plan.countedItems).toBe(1); // countedItems stays "physically counted"
      expect(plan.writtenOffItems).toBe(1);
    });

    it('keeps writeOffValue a strict subset of totalValueDiff', () => {
      const counted = line({ counted: true, countedQty: 8, expectedQty: 10, cost: 1000 });
      const missing = line({ expectedQty: 3, cost: 2000 });

      const plan = planCompletion([counted, missing], true);

      expect(plan.writeOffValue.toString()).toBe('-6000'); // 3 * 2000
      expect(plan.totalValueDiff.toString()).toBe('-8000'); // -2000 counted + -6000 write-off
      expect(plan.totalDifference.toString()).toBe('-5'); // -2 + -3
    });

    it('skips uncounted lines that already hold no stock', () => {
      // Writing 0 over 0 changes nothing but would bump updated_at and force every
      // terminal to re-pull the row.
      const alreadyEmpty = line({ expectedQty: 0, cost: 900 });
      const counted = line({ counted: true, countedQty: 1, expectedQty: 1 });

      const plan = planCompletion([alreadyEmpty, counted], true);

      expect(byId(plan, alreadyEmpty.id)).toBeUndefined();
      expect(plan.writtenOffItems).toBe(0);
      expect(plan.rows).toHaveLength(1);
    });

    it('writes off a line with no cost without breaking the value totals', () => {
      const noCost = line({ expectedQty: 7, cost: null });
      const counted = line({ counted: true, countedQty: 2, expectedQty: 2, cost: 100 });

      const plan = planCompletion([noCost, counted], true);

      expect(byId(plan, noCost.id)).toMatchObject({ difference: '-7', writtenOff: true });
      expect(plan.totalDifference.toString()).toBe('-7');
      expect(plan.writeOffValue.toString()).toBe('0'); // unknown cost contributes nothing
    });

    it('preserves difference = countedQty - expectedQty on every row', () => {
      const rows = [
        line({ counted: true, countedQty: 12, expectedQty: 10, cost: 5 }),
        line({ counted: true, countedQty: 0, expectedQty: 6, cost: 5 }),
        line({ expectedQty: 4, cost: 5 }),
      ];

      const plan = planCompletion(rows, true);

      for (const row of plan.rows) {
        const source = rows.find((r) => r.id === row.itemId)!;
        expect(new Prisma.Decimal(row.difference).toString()).toBe(
          new Prisma.Decimal(row.countedQty).minus(source.expectedQty).toString(),
        );
      }
    });

    it('handles fractional quantities without float drift', () => {
      const missing = line({ expectedQty: 0.3, cost: 0.1 });
      const counted = line({ counted: true, countedQty: 0.1, expectedQty: 0.2, cost: 0.1 });

      const plan = planCompletion([missing, counted], true);

      // 0.1 + 0.2 would be 0.30000000000000004 in float arithmetic.
      expect(plan.totalDifference.toString()).toBe('-0.4');
      expect(plan.writeOffValue.toString()).toBe('-0.03');
    });
  });

  // Stock missing from the shelf today may still be in transit and arrive tomorrow, so
  // the operator picks which uncounted lines are genuinely gone.
  describe('with a selected subset of write-off lines', () => {
    it('writes off only the selected lines and leaves the rest untouched', () => {
      const gone = line({ expectedQty: 4, cost: 1000 });
      const inTransit = line({ expectedQty: 7, cost: 2000 });
      const counted = line({ counted: true, countedQty: 3, expectedQty: 3, cost: 500 });

      const plan = planCompletion([gone, inTransit, counted], new Set([gone.id]));

      expect(byId(plan, gone.id)).toMatchObject({ countedQty: '0', writtenOff: true });
      // The line expected to arrive later must produce no stock write at all.
      expect(byId(plan, inTransit.id)).toBeUndefined();
      expect(plan.writtenOffItems).toBe(1);
      expect(plan.writeOffValue.toString()).toBe('-4000');
    });

    it('treats an empty selection as no write-off', () => {
      const gone = line({ expectedQty: 4, cost: 1000 });
      const counted = line({ counted: true, countedQty: 3, expectedQty: 3, cost: 500 });

      const plan = planCompletion([gone, counted], new Set<string>());

      expect(plan.rows).toHaveLength(1);
      expect(plan.writtenOffItems).toBe(0);
      expect(plan.writeOffValue.toString()).toBe('0');
    });

    it('ignores ids that are not eligible uncounted lines of this document', () => {
      const counted = line({ counted: true, countedQty: 2, expectedQty: 5, cost: 100 });
      const noStock = line({ expectedQty: 0, cost: 100 });

      // A counted line, a zero-stock line and an id from another document: selecting them
      // must not widen the write-off beyond what the eligibility rule already allows.
      const plan = planCompletion(
        [counted, noStock],
        new Set([counted.id, noStock.id, 'item-from-another-count']),
      );

      expect(plan.writtenOffItems).toBe(0);
      // The counted line still applies as a COUNT, not as a write-off.
      expect(byId(plan, counted.id)).toMatchObject({ countedQty: '2', writtenOff: false });
    });
  });

  it('reports zero counted lines so the caller can refuse to complete', () => {
    // The "nothing counted" guard is what stops a write-off from zeroing an entire
    // scope in one click, so it must hold even when write-off is requested.
    const plan = planCompletion([line({ expectedQty: 5, cost: 10 })], true);

    expect(plan.countedItems).toBe(0);
  });
});
