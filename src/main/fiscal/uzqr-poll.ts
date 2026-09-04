/**
 * UzQR polling decisions — pure, dependency-free so the rules are testable without a VCR.
 *
 * The buyer confirms a UzQR payment in their own bank app, so the POS has to sit in a loop
 * asking `Payment.Get` "has it landed yet?". Everything about when to ask again, and when to
 * give up, lives here rather than tangled into the async loop that performs the calls.
 */

/** The only status REGOS documents as paid. See the note on tolerateUnknownStatus below. */
export const UZQR_PAID_STATUS = 3;

/** Documented as "awaiting the buyer". Present for readability; nothing branches on it. */
export const UZQR_PENDING_STATUS = 2;

export interface PollOptions {
  intervalMs: number;
  timeoutMs: number;
}

export type PollDecision =
  | { action: 'paid' }
  | { action: 'retry'; delayMs: number }
  | { action: 'timeout' };

export const POLL_DEFAULTS: PollOptions = { intervalMs: 2_000, timeoutMs: 120_000 };

/** Floors that stop a mistyped setting from hammering the VCR or giving up instantly. */
const MIN_INTERVAL_MS = 500;
const MIN_TIMEOUT_MS = 5_000;

export function normalizePollOptions(opts: Partial<PollOptions> | undefined): PollOptions {
  const intervalMs = Math.max(
    MIN_INTERVAL_MS,
    Number.isFinite(opts?.intervalMs) ? Number(opts?.intervalMs) : POLL_DEFAULTS.intervalMs,
  );
  const timeoutMs = Math.max(
    MIN_TIMEOUT_MS,
    intervalMs,
    Number.isFinite(opts?.timeoutMs) ? Number(opts?.timeoutMs) : POLL_DEFAULTS.timeoutMs,
  );
  return { intervalMs, timeoutMs };
}

/**
 * What to do after one `Payment.Get`.
 *
 * `status` is null when the call itself failed — a dropped connection mid-payment is not a
 * failed payment, so that case retries like any other pending state rather than aborting and
 * leaving the buyer's money unaccounted for.
 *
 * Deliberately treats ONLY status 3 as terminal. The rest of REGOS's enum is undocumented, so
 * mapping an unrecognised value to "failed" would risk abandoning a payment that actually
 * succeeded — far worse than waiting out the timeout and letting the cashier decide.
 */
export function decideNextPoll(
  status: number | null,
  elapsedMs: number,
  opts: PollOptions,
): PollDecision {
  // Checked before the deadline on purpose: a payment confirmed on the very last poll is still
  // a payment, and discarding it because the clock ran out would take the buyer's money for no
  // receipt.
  if (status === UZQR_PAID_STATUS) return { action: 'paid' };

  const remaining = opts.timeoutMs - elapsedMs;
  if (remaining <= 0) return { action: 'timeout' };

  // Never sleep past the deadline — otherwise a 30 s interval on a 40 s timeout would overshoot
  // by 20 s and report the timeout long after it happened.
  return { action: 'retry', delayMs: Math.min(opts.intervalMs, remaining) };
}
