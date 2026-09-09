// Shaping for the fiscalization timing readout on the Fiscal settings screen. Kept out of the
// .tsx so the arithmetic — which is where this can quietly mislead — is unit-testable.

import type { FiscalPhaseStats } from '@shared/types';
import type { Theme } from '../../theme/themes';

/**
 * The pipeline phases in the order they run, matching the marks in fiscalizeSaleImpl.
 *
 * Keys reported outside this list (the TOTAL totals, and the `vcr:*` call timings) are rendered
 * separately, so a phase added in the main process without being listed here is simply left out
 * rather than breaking the layout.
 */
export const PHASE_ORDER = [
  'queue',
  'config',
  'load',
  'zreport',
  'build',
  'vcr-sale',
  'persist',
  'recover',
] as const;

export type PhaseName = (typeof PHASE_ORDER)[number];

/**
 * Colour per phase. `vcr-sale` gets the primary colour because it is normally most of the bar —
 * the device's own time, which we cannot do anything about. `queue` gets the warning colour
 * because a large queue share is the actionable finding: the receipt was waiting on us, not on
 * REGOS.
 */
export const PHASE_COLOR: Record<PhaseName, keyof Theme['colors']> = {
  queue: 'warning',
  config: 'textSecondary',
  load: 'info',
  zreport: 'secondary',
  build: 'success',
  'vcr-sale': 'primary',
  persist: 'border',
  recover: 'error',
};

export interface PhaseRow {
  name: PhaseName;
  stats: FiscalPhaseStats;
  meanMs: number;
}

/**
 * The phases present in a timings payload, in pipeline order, with their mean duration.
 *
 * The composition bar is built from MEANS, not medians, on purpose: means add up to the mean
 * total, so the segments are a truthful decomposition of a whole. Medians do not add up to
 * anything, and a stacked bar built from them would quietly misstate where the time went. The
 * p50/p95 columns beside the bar are the right place to read typical and worst-case values.
 */
export function phaseBreakdown(phases: Record<string, FiscalPhaseStats>): PhaseRow[] {
  return PHASE_ORDER.flatMap((name) => {
    const stats = phases[`phase:${name}`];
    if (!stats || stats.count === 0) return [];
    return [{ name, stats, meanMs: stats.totalMs / stats.count }];
  });
}

/** The `vcr:*` keys — one row per REGOS JSON-RPC method actually called, heaviest first. */
export function vcrBreakdown(
  phases: Record<string, FiscalPhaseStats>,
): Array<{ method: string; stats: FiscalPhaseStats }> {
  return Object.entries(phases)
    .filter(([key]) => key.startsWith('vcr:'))
    .map(([key, stats]) => ({ method: key.slice('vcr:'.length), stats }))
    .sort((a, b) => b.stats.totalMs - a.stats.totalMs);
}

/** Percentage width for each segment of the composition bar. Empty when there is nothing to show. */
export function stackPercents(rows: PhaseRow[]): number[] {
  const total = rows.reduce((sum, r) => sum + r.meanMs, 0);
  if (total <= 0) return [];
  return rows.map((r) => (r.meanMs / total) * 100);
}

/** The phase a receipt spent most of its time in — what the recent-receipts list annotates with. */
export function slowestPhase(
  phases: Array<{ name: string; ms: number }>,
): { name: string; ms: number } | null {
  if (phases.length === 0) return null;
  return phases.reduce((worst, p) => (p.ms > worst.ms ? p : worst));
}

/** A duration a cashier can read at a glance: `812 мс`, `1.9 с`. */
export function formatMs(ms: number, ms1: string, sec: string): string {
  if (ms < 1000) return `${Math.round(ms)} ${ms1}`;
  return `${(ms / 1000).toFixed(1)} ${sec}`;
}
