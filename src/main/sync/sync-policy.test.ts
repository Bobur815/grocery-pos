import { shouldSync, shouldUploadMasterData } from './sync-policy';

describe('shouldSync', () => {
  it('syncs an ONLINE store', () => {
    expect(shouldSync({ mode: 'ONLINE' })).toBe(true);
  });

  it('does not sync an OFFLINE_ONLY store', () => {
    expect(shouldSync({ mode: 'OFFLINE_ONLY' })).toBe(false);
  });

  // The live store runs on a build that predates this column, so every "unknown" shape below
  // must keep syncing exactly as it does today.
  it.each([
    ['never activated', { mode: null }],
    ['field absent', {}],
    ['config unreadable', null],
    ['config missing', undefined],
    ['unrecognised value from a newer server', { mode: 'SOMETHING_NEW' }],
  ])('syncs when the mode is unknown (%s)', (_label, config) => {
    expect(shouldSync(config)).toBe(true);
  });
});

describe('shouldUploadMasterData', () => {
  it('uploads for an admin on an unlocked store', () => {
    expect(shouldUploadMasterData('ADMIN', { posAdminLocked: false })).toBe(true);
  });

  it('does not upload once the store is locked to cashier-only', () => {
    expect(shouldUploadMasterData('ADMIN', { posAdminLocked: true })).toBe(false);
  });

  it('never uploads for a cashier, locked or not', () => {
    expect(shouldUploadMasterData('USER', { posAdminLocked: false })).toBe(false);
    expect(shouldUploadMasterData('USER', { posAdminLocked: true })).toBe(false);
  });

  it('does not upload when nobody is logged in', () => {
    expect(shouldUploadMasterData(undefined, { posAdminLocked: false })).toBe(false);
    expect(shouldUploadMasterData(null, { posAdminLocked: false })).toBe(false);
  });

  // This is the guarantee that protects the one live store: anything short of an explicit
  // `true` leaves the terminal uploading exactly as it always has.
  it.each([
    ['field absent', {}],
    ['explicitly null', { posAdminLocked: null }],
    ['config unreadable', null],
    ['config missing', undefined],
  ])('uploads for an admin when the lock is unknown (%s)', (_label, config) => {
    expect(shouldUploadMasterData('ADMIN', config)).toBe(true);
  });
});
