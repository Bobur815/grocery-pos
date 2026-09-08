import { AttemptThrottle } from './override-throttle';

/** A clock the test drives, so the lockout window can be crossed without waiting a minute. */
function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('AttemptThrottle', () => {
  it('allows attempts before anything has gone wrong', () => {
    expect(new AttemptThrottle().isLockedOut()).toBe(false);
  });

  it('allows up to the limit, then locks out', () => {
    const t = new AttemptThrottle(3, 60_000, clock().now);
    for (let i = 0; i < 3; i++) {
      expect(t.isLockedOut()).toBe(false);
      t.recordFailure();
    }
    expect(t.isLockedOut()).toBe(true);
  });

  // Someone who mistypes twice then gets it right must not be one slip from a lockout.
  it('forgets earlier failures once the password is accepted', () => {
    const t = new AttemptThrottle(3, 60_000, clock().now);
    t.recordFailure();
    t.recordFailure();
    t.reset();
    t.recordFailure();
    expect(t.isLockedOut()).toBe(false);
  });

  it('lifts the lockout after the window passes', () => {
    const c = clock();
    const t = new AttemptThrottle(3, 60_000, c.now);
    for (let i = 0; i < 3; i++) t.recordFailure();
    expect(t.isLockedOut()).toBe(true);

    c.advance(60_001);
    expect(t.isLockedOut()).toBe(false);
  });

  it('holds the lockout for the whole window', () => {
    const c = clock();
    const t = new AttemptThrottle(3, 60_000, c.now);
    for (let i = 0; i < 3; i++) t.recordFailure();

    c.advance(59_000);
    expect(t.isLockedOut()).toBe(true);
  });

  // The window is measured from the first failure, not the last, so an attacker cannot hold the
  // count just below the limit forever by pausing — but an honest user does get a fresh start.
  it('starts a fresh window after an expired one', () => {
    const c = clock();
    const t = new AttemptThrottle(3, 60_000, c.now);
    t.recordFailure();
    t.recordFailure();

    c.advance(60_001);
    t.recordFailure();
    // Only the newest failure counts, so two more are still allowed.
    expect(t.isLockedOut()).toBe(false);
    t.recordFailure();
    t.recordFailure();
    expect(t.isLockedOut()).toBe(true);
  });

  it('defaults to five attempts in a minute', () => {
    const c = clock();
    const t = new AttemptThrottle(undefined, undefined, c.now);
    for (let i = 0; i < 4; i++) t.recordFailure();
    expect(t.isLockedOut()).toBe(false);
    t.recordFailure();
    expect(t.isLockedOut()).toBe(true);

    c.advance(60_001);
    expect(t.isLockedOut()).toBe(false);
  });
});
