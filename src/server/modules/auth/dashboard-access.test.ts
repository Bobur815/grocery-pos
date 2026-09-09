import { dashboardLoginBlockReason, type DashboardStore } from './dashboard-access';

const online: DashboardStore = { active: true, mode: 'ONLINE' };
const offlineOnly: DashboardStore = { active: true, mode: 'OFFLINE_ONLY' };
const deactivated: DashboardStore = { active: false, mode: 'ONLINE' };

describe('dashboardLoginBlockReason', () => {
  it('lets an admin of a live online store in', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', online)).toBeNull();
  });

  it('lets a cashier of a live online store in', () => {
    expect(dashboardLoginBlockReason('USER', 's1', online)).toBeNull();
  });

  it('blocks a deactivated store', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', deactivated)).toBe('auth.errors.store_inactive');
  });

  it('blocks an OFFLINE_ONLY store, whose data lives on its terminal', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', offlineOnly)).toBe(
      'auth.errors.store_offline_only',
    );
  });

  // The refusal is a DASHBOARD rule. A POS terminal needs a credential for the vendor's shared
  // services and to read its own billing row — refusing it left such a terminal permanently
  // without one once its setup token expired, because nothing could ever mint another.
  it('lets a POS terminal of an OFFLINE_ONLY store in', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', offlineOnly, 'pos')).toBeNull();
  });

  it('still blocks the dashboard for the same store', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', offlineOnly, 'dashboard')).toBe(
      'auth.errors.store_offline_only',
    );
  });

  // An omitted field must not be the permissive one: anything that does not say it is a terminal
  // is treated as the browser.
  it('defaults to the dashboard rule when no client is given', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', offlineOnly)).toBe(
      'auth.errors.store_offline_only',
    );
  });

  // Deactivation is the more fundamental refusal and is not a dashboard-only concern: a store
  // that has been switched off should not have a working till either.
  it.each([['pos'], ['dashboard']] as const)('blocks a deactivated store for %s too', (client) => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', deactivated, client)).toBe(
      'auth.errors.store_inactive',
    );
  });

  it('blocks a POS terminal of a store that is both deactivated and OFFLINE_ONLY', () => {
    expect(
      dashboardLoginBlockReason('ADMIN', 's1', { active: false, mode: 'OFFLINE_ONLY' }, 'pos'),
    ).toBe('auth.errors.store_inactive');
  });

  // Being switched off is the more fundamental problem, and the more actionable message.
  it('reports deactivation ahead of offline mode when a store is both', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', { active: false, mode: 'OFFLINE_ONLY' })).toBe(
      'auth.errors.store_inactive',
    );
  });

  // The one that must never regress: a super admin deactivates a store, or flips it to
  // OFFLINE_ONLY, and then has to be able to log back in and undo it.
  it.each([
    ['a deactivated store', deactivated],
    ['an OFFLINE_ONLY store', offlineOnly],
    ['no store at all', null],
  ])('never blocks a SUPER_ADMIN, even with %s', (_label, store) => {
    expect(dashboardLoginBlockReason('SUPER_ADMIN', 's1', store)).toBeNull();
    expect(dashboardLoginBlockReason('SUPER_ADMIN', null, store)).toBeNull();
  });

  // Fail closed: if the row backing the session has gone, do not hand out a working session.
  it('treats a missing store as inactive', () => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', null)).toBe('auth.errors.store_inactive');
  });

  // A store-less non-super-admin is already rejected earlier in the login flow; this rule must
  // not invent a second, differently-worded refusal for it.
  it('does not block a user with no store', () => {
    expect(dashboardLoginBlockReason('ADMIN', null, null)).toBeNull();
  });

  // An older server value, or a mode this build does not know, must not lock people out.
  it.each([['ONLINE'], ['SOMETHING_NEW'], ['']])('allows an unrecognised mode %s', (mode) => {
    expect(dashboardLoginBlockReason('ADMIN', 's1', { active: true, mode })).toBeNull();
  });

  // Every reason must be a key the browser can translate.
  it('returns keys that exist in both locales', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ru = require('../../../renderer/i18n/locales/ru.json');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const uz = require('../../../renderer/i18n/locales/uz.json');
    for (const store of [deactivated, offlineOnly]) {
      const key = dashboardLoginBlockReason('ADMIN', 's1', store) as string;
      const leaf = key.replace('auth.errors.', '');
      expect(typeof ru.auth.errors[leaf]).toBe('string');
      expect(typeof uz.auth.errors[leaf]).toBe('string');
    }
  });
});
