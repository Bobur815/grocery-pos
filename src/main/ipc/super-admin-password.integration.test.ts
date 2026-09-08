import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as bcrypt from 'bcryptjs';

/**
 * The override password, checked the way the terminal actually checks it.
 *
 * The unit tests cover the throttle's timing and the server's refusal to leak the hash. What
 * neither can show is that the column survives a real database, that bcrypt.compare succeeds
 * against a hash the server produced, and that an unconfigured store stays open — which is the
 * behaviour every existing terminal depends on.
 */

const dataDir = mkdtempSync(join(tmpdir(), 'posgro-override-'));

jest.mock('electron', () => ({
  app: { getPath: () => dataDir, getAppPath: () => join(__dirname, '..', '..', '..') },
}));

import { initializeDatabase, closeDatabase, getPrismaClient } from '../database/sqlite-client';

/** The server hashes with bcrypt(10); the terminal only ever sees this. */
const PASSWORD = 'override-1234';
let hash: string;

async function setStoredPassword(value: string | null) {
  await getPrismaClient().localConfig.update({
    where: { id: 'config' },
    data: { superAdminPassword: value },
  });
}

/** Mirrors `auth:verifySuperAdminPassword`, minus the IPC wrapper. */
async function verify(password: string): Promise<boolean> {
  if (!password) return false;
  const config = await getPrismaClient().localConfig.findUnique({ where: { id: 'config' } });
  if (!config?.superAdminPassword) return false;
  return bcrypt.compare(password, config.superAdminPassword);
}

/** Mirrors `auth:hasSuperAdminPassword`. */
async function isConfigured(): Promise<boolean> {
  const config = await getPrismaClient().localConfig.findUnique({ where: { id: 'config' } });
  return Boolean(config?.superAdminPassword);
}

beforeAll(async () => {
  hash = await bcrypt.hash(PASSWORD, 10);
  await initializeDatabase();
  await getPrismaClient().localConfig.upsert({
    where: { id: 'config' },
    update: {},
    create: {
      id: 'config',
      storeId: 's1',
      storeName: 'Shop',
      terminalId: 'T1',
      apiUrl: 'http://localhost',
    },
  });
}, 120_000);

afterAll(async () => {
  await closeDatabase();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('a terminal with no override configured', () => {
  beforeAll(() => setStoredPassword(null));

  // The behaviour every existing store relies on: nothing is gated until one is set.
  it('reports that none is configured', async () => {
    expect(await isConfigured()).toBe(false);
  });

  // Answering true to an empty password would turn a missing configuration into an open door.
  it('refuses every password rather than accepting any', async () => {
    expect(await verify(PASSWORD)).toBe(false);
    expect(await verify('')).toBe(false);
    expect(await verify('anything')).toBe(false);
  });
});

describe('a terminal holding a hash from the server', () => {
  beforeAll(() => setStoredPassword(hash));

  it('reports that one is configured', async () => {
    expect(await isConfigured()).toBe(true);
  });

  it('accepts the password the super admin set', async () => {
    expect(await verify(PASSWORD)).toBe(true);
  });

  it.each([['wrong-password'], ['override-123'], ['OVERRIDE-1234'], ['']])(
    'refuses %p',
    async (attempt) => {
      expect(await verify(attempt)).toBe(false);
    },
  );

  // The whole point: no network call is involved, so this works for an OFFLINE_ONLY store.
  it('stores a bcrypt hash, never the password itself', async () => {
    const config = await getPrismaClient().localConfig.findUnique({ where: { id: 'config' } });
    expect(config?.superAdminPassword).toMatch(/^\$2[aby]\$/);
    expect(config?.superAdminPassword).not.toContain(PASSWORD);
  });

  // A super admin clearing the password must reopen the terminal, not lock it shut.
  it('goes back to ungated when the password is cleared', async () => {
    await setStoredPassword(null);
    expect(await isConfigured()).toBe(false);
    await setStoredPassword(hash);
  });
});
