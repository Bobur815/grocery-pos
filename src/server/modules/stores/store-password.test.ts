import { StoresService } from './stores.service';

/**
 * The manager-override hash must never leave the server through a store read.
 *
 * `GET /stores/:id` is reachable by a store's own ADMIN (`stores.controller.ts:40`), so a hash
 * appearing there would let them crack their own override offline — and `findAll()`/`findById()`
 * previously used no `select` at all, returning every column. This asserts the allowlist holds,
 * including for columns nobody has added yet.
 */

const STORE_ROW = {
  id: 's1',
  name: 'Shop',
  address: null,
  phone: null,
  active: true,
  aiPlan: 'free',
  balance: 0,
  subscriptionPlan: null,
  subscriptionExpiresAt: null,
  settings: null,
  scheduledDeleteAt: null,
  mode: 'ONLINE',
  posAdminLocked: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { users: 1, products: 2, sales: 3, terminalHeartbeats: 0 },
};

/** Captures the `select` each call passes, so the allowlist itself can be asserted. */
function build(superAdminPassword: string | null) {
  const row = { ...STORE_ROW, superAdminPassword };
  const selects: Record<string, unknown>[] = [];
  const prisma = {
    store: {
      findMany: jest.fn(async (args: { select: Record<string, unknown> }) => {
        selects.push(args.select);
        return [row];
      }),
      findUnique: jest.fn(async (args: { select: Record<string, unknown> }) => {
        selects.push(args.select);
        return row;
      }),
      update: jest.fn(async (_args: { data: Record<string, unknown> }) => row),
    },
  };
  return { service: new StoresService(prisma as never), prisma, selects };
}

/** The `data` payload the service handed to prisma.store.update(). */
function updateData(prisma: ReturnType<typeof build>['prisma']): Record<string, unknown> {
  const call = prisma.store.update.mock.calls[0];
  if (!call) throw new Error('store.update was never called');
  return call[0].data;
}

describe('store reads never expose the override hash', () => {
  it.each([
    ['findAll', async (s: StoresService) => (await s.findAll())[0]],
    ['findById', async (s: StoresService) => s.findById('s1')],
  ])('%s strips it and reports only whether one is set', async (_label, call) => {
    const { service } = build('$2b$10$somethingthatlookslikeahash');
    const result = (await call(service)) as Record<string, unknown>;

    expect(result).not.toHaveProperty('superAdminPassword');
    expect(result.hasSuperAdminPassword).toBe(true);
    // The fields the dashboard renders must survive the allowlist.
    expect(result).toMatchObject({ id: 's1', name: 'Shop', mode: 'ONLINE' });
    expect(result._count).toEqual({ users: 1, products: 2, sales: 3, terminalHeartbeats: 0 });
  });

  it('reports false when no override is configured', async () => {
    const { service } = build(null);
    const store = await service.findById('s1');
    expect(store.hasSuperAdminPassword).toBe(false);
    expect(store).not.toHaveProperty('superAdminPassword');
  });

  // The serialized JSON is what actually reaches the browser — assert on that, not just the shape.
  it('leaves no trace of the hash in the response JSON', async () => {
    const { service } = build('$2b$10$secretsecretsecret');
    const json = JSON.stringify(await service.findById('s1'));
    expect(json).not.toContain('$2b$');
    expect(json).not.toContain('superAdminPassword');
  });

  // An allowlist, not a strip: a column added to the schema later must not appear by default.
  it('selects an explicit allowlist rather than every column', async () => {
    const { service, selects } = build(null);
    await service.findById('s1');
    const select = selects[0];
    expect(select).toBeDefined();
    expect(Object.keys(select).length).toBeGreaterThan(5);
    // It asks for the hash on purpose — that is how hasSuperAdminPassword is computed — but the
    // caller-facing object drops it, which the assertions above cover.
    expect(select.superAdminPassword).toBe(true);
  });
});

describe('update()', () => {
  it('hashes a new password instead of storing it raw', async () => {
    const { service, prisma } = build(null);
    await service.update('s1', { superAdminPassword: 'override-1234' } as never);

    const data = updateData(prisma);
    expect(data.superAdminPassword).toMatch(/^\$2[aby]\$/);
    expect(data.superAdminPassword).not.toContain('override-1234');
  });

  it('clears it on an empty string', async () => {
    const { service, prisma } = build('$2b$10$existing');
    await service.update('s1', { superAdminPassword: '' } as never);
    expect(updateData(prisma).superAdminPassword).toBeNull();
  });

  // The dashboard sends a blank field when the super admin is editing something else entirely.
  it('leaves it untouched when the field is absent', async () => {
    const { service, prisma } = build('$2b$10$existing');
    await service.update('s1', { name: 'Renamed' } as never);
    expect(updateData(prisma)).not.toHaveProperty('superAdminPassword');
  });
});
