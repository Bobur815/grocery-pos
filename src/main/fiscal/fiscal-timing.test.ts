/**
 * The timing store itself: aggregation, the bounded buffers, and the VCR-call recording that the
 * service tests cannot cover (they mock the client, so the real JSON-RPC `call()` never runs).
 */

jest.mock('../logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { log } from '../logger';
import { record, recordVcrCall, stats, recentSales, reset, FiscalTimer } from './fiscal-timing';

beforeEach(() => {
  reset();
  jest.clearAllMocks();
});

describe('aggregation', () => {
  it('summarises a set of samples', () => {
    for (const ms of [10, 20, 30, 40, 100]) record('phase:build', ms);

    expect(stats()['phase:build']).toEqual({
      count: 5,
      totalMs: 200,
      minMs: 10,
      maxMs: 100,
      p50Ms: 30,
      p95Ms: 100,
    });
  });

  it('reports zeroes rather than NaN for a key with no samples', () => {
    record('phase:x', 5);
    reset();
    expect(stats()).toEqual({});
  });

  it('keeps the buffer bounded so a long shift cannot grow it without limit', () => {
    for (let i = 0; i < 500; i++) record('phase:build', i);

    const s = stats()['phase:build'];
    expect(s.count).toBe(200);
    // The oldest samples were dropped, so the window is the most recent 200.
    expect(s.minMs).toBe(300);
    expect(s.maxMs).toBe(499);
  });
});

describe('recordVcrCall', () => {
  it('times every round-trip under its method name', () => {
    recordVcrCall('Receipt.Sale', 120);
    recordVcrCall('Receipt.Sale', 180);

    expect(stats()['vcr:Receipt.Sale']).toMatchObject({ count: 2, maxMs: 180 });
  });

  it('warns about a slow call so it is visible in the uploaded logs', () => {
    recordVcrCall('Receipt.Sale', 4_000);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('slow VCR call Receipt.Sale'));
  });

  it('stays quiet for a normal call', () => {
    recordVcrCall('Receipt.Sale', 150);

    expect(log.warn).not.toHaveBeenCalled();
  });

  it('records a failed call too — a timeout is the sample most worth keeping', () => {
    // The client times these in a finally, so this is the shape a 30s timeout arrives in.
    recordVcrCall('Receipt.Sale', 30_000);

    expect(stats()['vcr:Receipt.Sale'].maxMs).toBe(30_000);
  });
});

describe('FiscalTimer', () => {
  it('splits the elapsed time into consecutive phases and keeps the breakdown', () => {
    const timer = new FiscalTimer();
    timer.phase('queue');
    timer.phase('build');
    timer.finish('R-9', true);

    const [entry] = recentSales();
    expect(entry.receiptNumber).toBe('R-9');
    expect(entry.ok).toBe(true);
    expect(entry.phases.map((p) => p.name)).toEqual(['queue', 'build']);
    expect(stats()['phase:TOTAL'].count).toBe(1);
  });

  it('separates failed totals from successful ones', () => {
    new FiscalTimer().finish('R-1', false);

    expect(stats()['phase:TOTAL']).toBeUndefined();
    expect(stats()['phase:TOTAL_FAILED'].count).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('R-1 FAILED'));
  });

  it('returns recent sales newest first and keeps that list bounded', () => {
    for (let i = 0; i < 60; i++) new FiscalTimer().finish(`R-${i}`, true);

    const recent = recentSales();
    expect(recent).toHaveLength(50);
    expect(recent[0].receiptNumber).toBe('R-59');
  });
});
