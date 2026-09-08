/**
 * Throttle for guessing at the manager-override password.
 *
 * bcrypt already makes each attempt slow, but the prompt sits on a till that anyone can walk up
 * to, so a run of wrong answers should stop being answered at all for a while.
 *
 * Kept as a standalone class so the timing rules can be tested without Electron — the same reason
 * `sync-policy.ts` and `dashboard-access.ts` are separate from their callers.
 *
 * In memory on purpose. A restart clearing it is acceptable: the alternative, persisting it, would
 * let anyone lock the manager out of their own till by mashing a wrong password five times.
 */
export class AttemptThrottle {
  private attempts = 0;
  private windowStartedAt = 0;

  constructor(
    private readonly maxAttempts = 5,
    private readonly lockoutMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True while further attempts should be refused without even checking the password. */
  isLockedOut(): boolean {
    if (this.windowExpired()) {
      this.attempts = 0;
      return false;
    }
    return this.attempts >= this.maxAttempts;
  }

  recordFailure(): void {
    if (this.attempts === 0 || this.windowExpired()) {
      this.windowStartedAt = this.now();
      this.attempts = 1;
      return;
    }
    this.attempts += 1;
  }

  /** A correct password wipes the slate, so an honest mistyper is never left locked out. */
  reset(): void {
    this.attempts = 0;
    this.windowStartedAt = 0;
  }

  private windowExpired(): boolean {
    return this.now() - this.windowStartedAt > this.lockoutMs;
  }
}
