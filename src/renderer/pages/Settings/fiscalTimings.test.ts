/**
 * Shaping for the fiscal timing readout.
 *
 * The composition bar is the part worth pinning: it must decompose a real whole, so it is built
 * from means (which sum to the mean total) rather than medians (which sum to nothing in
 * particular). A bar built from medians would look plausible and be wrong.
 */

import {
  PHASE_ORDER,
  PHASE_COLOR,
  phaseBreakdown,
  vcrBreakdown,
  stackPercents,
  slowestPhase,
  formatMs,
} from './fiscalTimings';
import type { FiscalPhaseStats } from '@shared/types';

function stats(over: Partial<FiscalPhaseStats> = {}): FiscalPhaseStats {
  return { count: 1, totalMs: 100, minMs: 100, maxMs: 100, p50Ms: 100, p95Ms: 100, ...over };
}

describe('phaseBreakdown', () => {
  it('returns phases in pipeline order regardless of key order', () => {
    const rows = phaseBreakdown({
      'phase:persist': stats(),
      'phase:queue': stats(),
      'phase:vcr-sale': stats(),
    });

    expect(rows.map((r) => r.name)).toEqual(['queue', 'vcr-sale', 'persist']);
  });

  it('computes the mean per phase', () => {
    const rows = phaseBreakdown({ 'phase:build': stats({ count: 4, totalMs: 50 }) });

    expect(rows[0].meanMs).toBe(12.5);
  });

  it('skips phases with no samples instead of dividing by zero', () => {
    const rows = phaseBreakdown({ 'phase:recover': stats({ count: 0, totalMs: 0 }) });

    expect(rows).toEqual([]);
  });

  it('ignores the TOTAL keys and the vcr call timings', () => {
    const rows = phaseBreakdown({
      'phase:TOTAL': stats(),
      'phase:TOTAL_FAILED': stats(),
      'vcr:Receipt.Sale': stats(),
      'phase:build': stats(),
    });

    expect(rows.map((r) => r.name)).toEqual(['build']);
  });

  it('leaves out a phase the main process reports but this screen does not know', () => {
    // A new mark added to fiscalizeSaleImpl must not break the layout before the UI catches up.
    const rows = phaseBreakdown({ 'phase:something-new': stats(), 'phase:build': stats() });

    expect(rows.map((r) => r.name)).toEqual(['build']);
  });
});

describe('stackPercents', () => {
  it('gives each phase its share of the mean total, summing to 100', () => {
    const rows = phaseBreakdown({
      'phase:queue': stats({ count: 1, totalMs: 25 }),
      'phase:vcr-sale': stats({ count: 1, totalMs: 75 }),
    });

    expect(stackPercents(rows)).toEqual([25, 75]);
  });

  it('stays aligned with the rows it was built from', () => {
    const rows = phaseBreakdown({
      'phase:queue': stats({ count: 2, totalMs: 20 }),
      'phase:build': stats({ count: 1, totalMs: 10 }),
      'phase:vcr-sale': stats({ count: 1, totalMs: 80 }),
    });
    const pcts = stackPercents(rows);

    expect(pcts).toHaveLength(rows.length);
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });

  it('returns nothing to draw when every phase measured zero', () => {
    const rows = phaseBreakdown({ 'phase:build': stats({ count: 3, totalMs: 0 }) });

    expect(stackPercents(rows)).toEqual([]);
  });

  it('returns nothing to draw with no phases at all', () => {
    expect(stackPercents([])).toEqual([]);
  });
});

describe('vcrBreakdown', () => {
  it('lists REGOS methods heaviest first, stripped of the key prefix', () => {
    const rows = vcrBreakdown({
      'vcr:ZReport.GetInfo': stats({ totalMs: 30 }),
      'vcr:Receipt.Sale': stats({ totalMs: 900 }),
      'phase:build': stats({ totalMs: 5000 }),
    });

    expect(rows.map((r) => r.method)).toEqual(['Receipt.Sale', 'ZReport.GetInfo']);
  });

  it('is empty before any device call has been made', () => {
    expect(vcrBreakdown({ 'phase:queue': stats() })).toEqual([]);
  });
});

describe('slowestPhase', () => {
  it('finds the phase a receipt spent most of its time in', () => {
    expect(
      slowestPhase([
        { name: 'queue', ms: 5 },
        { name: 'vcr-sale', ms: 780 },
        { name: 'persist', ms: 3 },
      ]),
    ).toEqual({ name: 'vcr-sale', ms: 780 });
  });

  it('returns null rather than undefined for a receipt with no phases', () => {
    expect(slowestPhase([])).toBeNull();
  });
});

describe('formatMs', () => {
  it('uses milliseconds below a second, rounded', () => {
    expect(formatMs(812.4, 'мс', 'с')).toBe('812 мс');
    expect(formatMs(0, 'мс', 'с')).toBe('0 мс');
  });

  it('switches to seconds at a second, to one decimal', () => {
    expect(formatMs(1000, 'мс', 'с')).toBe('1.0 с');
    expect(formatMs(1949, 'мс', 'с')).toBe('1.9 с');
    expect(formatMs(30_000, 'мс', 'с')).toBe('30.0 с');
  });
});

describe('PHASE_COLOR', () => {
  it('covers every phase the readout can render', () => {
    // A phase in PHASE_ORDER without a colour would render an undefined swatch.
    for (const name of PHASE_ORDER) {
      expect(PHASE_COLOR[name]).toBeDefined();
    }
  });
});
