import {
  decideNextPoll,
  normalizePollOptions,
  POLL_DEFAULTS,
  UZQR_PAID_STATUS,
  UZQR_PENDING_STATUS,
} from './uzqr-poll';

const opts = { intervalMs: 2_000, timeoutMs: 120_000 };

describe('decideNextPoll', () => {
  it('stops as soon as the payment is marked paid', () => {
    expect(decideNextPoll(UZQR_PAID_STATUS, 4_000, opts)).toEqual({ action: 'paid' });
  });

  it('keeps waiting while the buyer has not confirmed', () => {
    expect(decideNextPoll(UZQR_PENDING_STATUS, 4_000, opts)).toEqual({
      action: 'retry',
      delayMs: 2_000,
    });
  });

  it('keeps waiting on an unrecognised status rather than calling it a failure', () => {
    // REGOS only documents 2 and 3. Treating an unknown code as failure could abandon a payment
    // that actually succeeded, which costs the buyer real money.
    expect(decideNextPoll(7, 4_000, opts)).toEqual({ action: 'retry', delayMs: 2_000 });
  });

  it('keeps waiting when the poll call itself failed', () => {
    // A dropped connection mid-payment is not a failed payment.
    expect(decideNextPoll(null, 4_000, opts)).toEqual({ action: 'retry', delayMs: 2_000 });
  });

  it('times out once the deadline passes', () => {
    expect(decideNextPoll(UZQR_PENDING_STATUS, 120_000, opts)).toEqual({ action: 'timeout' });
    expect(decideNextPoll(null, 130_000, opts)).toEqual({ action: 'timeout' });
  });

  it('accepts a payment that lands on the very last poll', () => {
    // Paid is checked before the deadline: money moved, so the receipt must follow.
    expect(decideNextPoll(UZQR_PAID_STATUS, 999_999, opts)).toEqual({ action: 'paid' });
  });

  it('never sleeps past the deadline', () => {
    // 30 s interval with 5 s left would otherwise overshoot and report the timeout 25 s late.
    const slow = { intervalMs: 30_000, timeoutMs: 40_000 };
    expect(decideNextPoll(UZQR_PENDING_STATUS, 35_000, slow)).toEqual({
      action: 'retry',
      delayMs: 5_000,
    });
  });
});

describe('normalizePollOptions', () => {
  it('falls back to the defaults when unset', () => {
    expect(normalizePollOptions(undefined)).toEqual(POLL_DEFAULTS);
    expect(normalizePollOptions({})).toEqual(POLL_DEFAULTS);
  });

  it('floors a too-eager interval so a typo cannot hammer the VCR', () => {
    // VCR is single-threaded; a 0 ms interval would starve fiscalization of the device.
    expect(normalizePollOptions({ intervalMs: 0 }).intervalMs).toBe(500);
    expect(normalizePollOptions({ intervalMs: -5 }).intervalMs).toBe(500);
  });

  it('never lets the timeout fall below one interval', () => {
    const o = normalizePollOptions({ intervalMs: 10_000, timeoutMs: 1_000 });
    expect(o.timeoutMs).toBeGreaterThanOrEqual(o.intervalMs);
  });

  it('ignores non-numeric settings', () => {
    const o = normalizePollOptions({ intervalMs: NaN, timeoutMs: NaN });
    expect(o).toEqual(POLL_DEFAULTS);
  });

  it('keeps sensible custom values', () => {
    expect(normalizePollOptions({ intervalMs: 3_000, timeoutMs: 90_000 })).toEqual({
      intervalMs: 3_000,
      timeoutMs: 90_000,
    });
  });
});
