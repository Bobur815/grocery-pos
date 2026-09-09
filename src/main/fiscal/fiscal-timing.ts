// Fiscalization timing instrumentation (main process).
//
// Answers one question when a cashier reports "the receipt took forever": WHERE did the time go —
// waiting for the single-threaded VCR device, waiting behind another receipt in our own queue, or
// in our local work before the device is ever contacted.
//
// Everything here is in-memory and bounded. It is diagnostics, not a metrics pipeline: the numbers
// reset when the app restarts, which is fine because the question is always about the current
// terminal in the current shift.

import { log } from '../logger';
import type { FiscalPhaseStats, FiscalSaleTiming } from '../../shared/types/fiscal.types';

export type { FiscalPhaseStats, FiscalSaleTiming };

/** Samples kept per key. ~200 receipts is well over a busy shift's worth of recent history. */
const MAX_SAMPLES = 200;
/** Per-sale breakdowns kept for the settings screen. */
const MAX_RECENT = 50;
/** A single VCR call slower than this is worth a log line on its own. */
const SLOW_CALL_MS = 2_000;
/** A whole fiscalization slower than this is worth a warning. */
const SLOW_TOTAL_MS = 5_000;

const samples = new Map<string, number[]>();
const recent: FiscalSaleTiming[] = [];

/** Record one duration under `key`. Keys are namespaced: `vcr:<Method>` vs `phase:<name>`. */
export function record(key: string, ms: number): void {
  let arr = samples.get(key);
  if (!arr) {
    arr = [];
    samples.set(key, arr);
  }
  arr.push(ms);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

/**
 * Record one VCR round-trip. Called from the JSON-RPC client for every request, successful or
 * not — a 30s timeout is exactly the sample worth keeping, and it shows up as the max.
 */
export function recordVcrCall(method: string, ms: number): void {
  record(`vcr:${method}`, ms);
  if (ms >= SLOW_CALL_MS) {
    log.warn(`[fiscal-timing] slow VCR call ${method} ${Math.round(ms)}ms`);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function statsFor(arr: number[]): FiscalPhaseStats {
  const sorted = [...arr].sort((a, b) => a - b);
  const totalMs = arr.reduce((s, n) => s + n, 0);
  return {
    count: arr.length,
    totalMs: Math.round(totalMs),
    minMs: Math.round(sorted[0] ?? 0),
    maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
  };
}

/** Aggregates for every key seen since startup, for the Fiscal settings screen and support. */
export function stats(): Record<string, FiscalPhaseStats> {
  const out: Record<string, FiscalPhaseStats> = {};
  for (const [key, arr] of samples) out[key] = statsFor(arr);
  return out;
}

/** The last few per-sale breakdowns, newest first. */
export function recentSales(): FiscalSaleTiming[] {
  return [...recent].reverse();
}

export function reset(): void {
  samples.clear();
  recent.length = 0;
}

/**
 * Stopwatch for one fiscalization. `phase(name)` closes the segment since the previous mark, so
 * the phases always sum to the total and no time can hide between them.
 *
 * Created at the moment fiscalizeSale() is *called* rather than when it starts executing, so the
 * first phase measures the wait for the VCR queue — the one cost that is invisible from inside
 * the device and the usual explanation for a receipt that took far longer than the device did.
 */
export class FiscalTimer {
  private readonly startedAt = performance.now();
  private last = this.startedAt;
  private readonly phases: Array<{ name: string; ms: number }> = [];

  phase(name: string): void {
    const now = performance.now();
    this.phases.push({ name, ms: now - this.last });
    this.last = now;
    record(`phase:${name}`, this.phases[this.phases.length - 1].ms);
  }

  /**
   * Close the timer, keep the breakdown, and emit one summary line. Goes through electron-log so
   * it reaches the uploaded terminal logs — the only way to see this from a store's terminal.
   */
  finish(receiptNumber: string, ok: boolean): void {
    const totalMs = performance.now() - this.startedAt;
    record(ok ? 'phase:TOTAL' : 'phase:TOTAL_FAILED', totalMs);

    recent.push({
      at: new Date().toISOString(),
      receiptNumber,
      totalMs: Math.round(totalMs),
      ok,
      phases: this.phases.map((p) => ({ name: p.name, ms: Math.round(p.ms) })),
    });
    if (recent.length > MAX_RECENT) recent.shift();

    const breakdown = this.phases.map((p) => `${p.name}=${Math.round(p.ms)}ms`).join(' ');
    const line = `[fiscal-timing] ${receiptNumber} ${ok ? 'ok' : 'FAILED'} total=${Math.round(totalMs)}ms ${breakdown}`;
    if (totalMs >= SLOW_TOTAL_MS || !ok) log.warn(line);
    else log.info(line);
  }
}
