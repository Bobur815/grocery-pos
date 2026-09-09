/**
 * Fiscalization round-trip behaviour, at the level a cashier feels it: how many times we talk to
 * the device, and whether a receipt still lands when the device disagrees with us.
 *
 * These cover the three changes made to speed fiscalization up, each of which trades a round-trip
 * for a recovery path — so the recovery paths are the ones that must be proven:
 *  - the Z-report state is cached instead of re-read before every receipt (recovered via 704010),
 *  - Receipt.ValidateSale is no longer sent before Receipt.Sale (VAT heal must still fire),
 *  - line products are fetched in one query instead of one per line.
 */

jest.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
}));
jest.mock('../logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('../config/app-config', () => ({ getAppConfig: () => ({ terminalId: 'T1' }) }));
jest.mock('./secret-store', () => ({
  getVcrPassword: async () => 'pw',
  hasVcrPassword: async () => true,
  setVcrPassword: async () => undefined,
}));
jest.mock('../marking/circulation-check', () => ({ isCodeOutOfCirculation: async () => false }));

const prismaMock = {
  systemSetting: {
    findMany: jest.fn(async () => [
      { key: 'regos_vcr_enabled', value: 'true' },
      { key: 'regos_vcr_url', value: 'http://127.0.0.1:22298/' },
      { key: 'regos_vcr_login', value: 'cassir' },
      { key: 'regos_vcr_vat', value: '12' },
      { key: 'regos_vcr_pos_id', value: 'POS1' },
    ]),
    findUnique: jest.fn(async () => null),
    upsert: jest.fn(async () => undefined),
  },
  sale: { findUnique: jest.fn(), update: jest.fn(async () => undefined) },
  product: { findMany: jest.fn(), update: jest.fn(async () => undefined) },
  smena: {
    update: jest.fn(async () => undefined),
    findFirst: jest.fn<Promise<unknown>, unknown[]>(async () => ({ id: 'smena-1' })),
  },
};
jest.mock('../database/sqlite-client', () => ({ getPrismaClient: () => prismaMock }));

// Untyped on purpose: these stand in for RegosVcrClient methods whose return types are only
// interesting per-test, and jest's mockResolvedValue would otherwise be pinned by the first
// implementation given here.
const client = {
  zGetInfo: jest.fn<Promise<unknown>, []>(),
  zOpen: jest.fn(async () => ({ id: 7 })),
  validateSale: jest.fn<Promise<unknown>, unknown[]>(async () => ({ validate: true })),
  sale: jest.fn<Promise<unknown>, unknown[]>(),
  getReceiptInfo: jest.fn<Promise<unknown>, unknown[]>(async () => null),
};
jest.mock('./regos-vcr-client', () => {
  const actual = jest.requireActual('./regos-vcr-client');
  return { ...actual, RegosVcrClient: jest.fn(() => client) };
});

import { VcrError } from './regos-vcr-client';
import { regosVcrService } from './regos-vcr-service';
import { reset as resetTimings, stats } from './fiscal-timing';

const OPEN_Z = { OpenTime: '2026-09-09 08:00:00', CloseTime: '' };
const SALE_OK = {
  Id: 'vcr-1',
  FiscalSign: 'SIGN',
  QRCodeURL: 'https://ofd.soliq.uz/check?t=X&r=1&s=123',
  TerminalID: 'TID',
  ReceiptNo: '42',
};

function saleRow(items = 1) {
  return {
    id: 'sale-1',
    receiptNumber: 'R-1',
    fiscalStatus: 'PENDING',
    smenaId: 'smena-1',
    cashierName: 'Cashier',
    discountAmount: 0,
    regosLabels: null,
    regosPaymentId: null,
    paymentMethod: 'cash',
    finalAmount: 1000,
    items: Array.from({ length: items }, (_, i) => ({
      productId: i + 1,
      productName: `P${i + 1}`,
      barcode: `${1000 + i}`,
      quantity: 1,
      piecesPerUnit: 1,
      subtotal: 1000,
    })),
  };
}

function products(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    mxik: '01234567890123456',
    vatRate: 12,
    unit: 'шт',
    packageCode: null,
    category: { nameRu: 'Прочее' },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetTimings();
  // Each test starts from a service that has not yet confirmed the device's Z-report.
  (regosVcrService as unknown as { zReportOpen: boolean }).zReportOpen = false;
  client.zGetInfo.mockResolvedValue(OPEN_Z);
  client.sale.mockResolvedValue(SALE_OK);
  prismaMock.sale.findUnique.mockImplementation(async () => saleRow());
  prismaMock.product.findMany.mockImplementation(async () => products(1));
});

describe('fiscalizeSale — device round-trips', () => {
  it('does not send Receipt.ValidateSale on the happy path', async () => {
    await regosVcrService.fiscalizeSale('sale-1');

    // The pre-flight doubled the traffic to a single-threaded device to learn what Receipt.Sale
    // reports anyway. Validation now only runs on the failure path, inside the VAT heal.
    expect(client.validateSale).not.toHaveBeenCalled();
    expect(client.sale).toHaveBeenCalledTimes(1);
  });

  it('asks the device about the Z-report once, then trusts the cache', async () => {
    await regosVcrService.fiscalizeSale('sale-1');
    await regosVcrService.fiscalizeSale('sale-1');
    await regosVcrService.fiscalizeSale('sale-1');

    expect(client.zGetInfo).toHaveBeenCalledTimes(1);
    expect(client.sale).toHaveBeenCalledTimes(3);
  });

  it('costs exactly one device round-trip per steady-state receipt', async () => {
    // The number this whole exercise is about. It used to be three — ZReport.GetInfo,
    // Receipt.ValidateSale, Receipt.Sale — on a device that can only do one at a time, so every
    // receipt paid three serial waits and a queue of them multiplied that.
    await regosVcrService.fiscalizeSale('sale-1'); // first of the shift: also checks the Z-report
    const callsAfterFirst =
      client.zGetInfo.mock.calls.length +
      client.zOpen.mock.calls.length +
      client.validateSale.mock.calls.length +
      client.sale.mock.calls.length;

    await regosVcrService.fiscalizeSale('sale-1');
    const callsAfterSecond =
      client.zGetInfo.mock.calls.length +
      client.zOpen.mock.calls.length +
      client.validateSale.mock.calls.length +
      client.sale.mock.calls.length;

    expect(callsAfterFirst).toBe(2); // ZReport.GetInfo + Receipt.Sale
    expect(callsAfterSecond - callsAfterFirst).toBe(1); // Receipt.Sale alone
  });

  it('opens a closed Z-report and records it against the shift', async () => {
    client.zGetInfo.mockResolvedValue({ OpenTime: '', CloseTime: '' });

    await regosVcrService.fiscalizeSale('sale-1');

    expect(client.zOpen).toHaveBeenCalledTimes(1);
    expect(prismaMock.smena.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { regosZReportId: 7 } }),
    );
  });

  it('loads every line product in one query, not one per line', async () => {
    prismaMock.sale.findUnique.mockImplementation(async () => saleRow(12));
    prismaMock.product.findMany.mockImplementation(async () => products(12));

    await regosVcrService.fiscalizeSale('sale-1');

    expect(prismaMock.product.findMany).toHaveBeenCalledTimes(1);
    const sent = client.sale.mock.calls[0][0] as { positions: unknown[] };
    expect(sent.positions).toHaveLength(12);
  });
});

describe('fiscalizeSale — recovery paths that pay for the removed round-trips', () => {
  it('re-opens the Z-report and retries when the cached state was stale', async () => {
    // Warm the cache with a device that really did have an open Z-report.
    await regosVcrService.fiscalizeSale('sale-1');
    expect(client.zGetInfo).toHaveBeenCalledTimes(1);

    // Now it is closed behind our back (closed in the REGOS app, or the 24h auto-close).
    client.sale
      .mockRejectedValueOnce(new VcrError(704010, 'Z-отчёт не открыт', 'Receipt.Sale'))
      .mockResolvedValueOnce(SALE_OK);
    client.zGetInfo.mockResolvedValue({ OpenTime: '', CloseTime: '' });

    await regosVcrService.fiscalizeSale('sale-1');

    // Re-checked for real rather than trusting the cache, re-opened, and the receipt still landed.
    expect(client.zGetInfo).toHaveBeenCalledTimes(2);
    expect(client.zOpen).toHaveBeenCalledTimes(1);
    expect(prismaMock.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fiscalStatus: 'FISCALIZED', regosReceiptNo: '42' }),
      }),
    );
  });

  it('only re-opens once, so a persistent 704010 fails instead of looping', async () => {
    client.sale.mockRejectedValue(new VcrError(704010, 'Z-отчёт не открыт', 'Receipt.Sale'));

    await expect(regosVcrService.fiscalizeSale('sale-1')).rejects.toThrow(VcrError);

    expect(client.sale).toHaveBeenCalledTimes(2);
  });

  it('still heals a VAT rate now that the rejection arrives from Receipt.Sale', async () => {
    // Previously this error surfaced from the pre-flight ValidateSale. The heal must trigger on
    // the Sale rejection just the same, or a whole catalog of wrong rates goes unfixed.
    client.sale
      .mockRejectedValueOnce(new VcrError(701003, 'Ставка НДС не найдена', 'Receipt.Sale'))
      .mockResolvedValueOnce(SALE_OK);
    // The heal probes candidate rates; reject 12% and accept the next one it tries.
    client.validateSale
      .mockRejectedValueOnce(new VcrError(701003, 'Ставка НДС не найдена', 'Receipt.ValidateSale'))
      .mockResolvedValue({ validate: true });

    await regosVcrService.fiscalizeSale('sale-1');

    expect(client.validateSale).toHaveBeenCalled();
    expect(client.sale).toHaveBeenCalledTimes(2);
    // The discovered rate is written back to the product so no terminal repeats the failure.
    expect(prismaMock.product.update).toHaveBeenCalled();
    expect(prismaMock.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fiscalStatus: 'FISCALIZED' }),
      }),
    );
  });

  it('adopts a receipt the device already registered when the response was lost', async () => {
    client.sale.mockRejectedValue(new VcrError(701003, 'Чек с таким кодом уже существует', 'Receipt.Sale'));
    client.getReceiptInfo.mockResolvedValue({ ...SALE_OK, Code: 'sale-1' });

    await regosVcrService.fiscalizeSale('sale-1');

    expect(prismaMock.sale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fiscalStatus: 'FISCALIZED', regosReceiptNo: '42' }),
      }),
    );
  });
});

describe('start() — Z-report warm-up', () => {
  it('learns the Z-report state at startup so the first receipt does not pay for it', async () => {
    // Measured on a real device: ZReport.GetInfo costs ~1.4s. Without this, the first customer
    // after a mid-day restart waits it out on top of their own receipt.
    regosVcrService.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.zGetInfo).toHaveBeenCalledTimes(1);

    await regosVcrService.fiscalizeSale('sale-1');

    expect(client.zGetInfo).toHaveBeenCalledTimes(1); // still 1 — the sale reused the warm value
    expect(client.sale).toHaveBeenCalledTimes(1);
  });

  it('never opens a Z-report at startup — that is a fiscal action, not a warm-up', async () => {
    client.zGetInfo.mockResolvedValue({ OpenTime: '', CloseTime: '' });

    regosVcrService.start();
    await new Promise((r) => setTimeout(r, 0));

    expect(client.zOpen).not.toHaveBeenCalled();
  });

  it('leaves the cache cold when the device says the Z-report is closed', async () => {
    client.zGetInfo.mockResolvedValue({ OpenTime: '', CloseTime: '' });
    regosVcrService.start();
    await new Promise((r) => setTimeout(r, 0));
    client.zGetInfo.mockResolvedValue(OPEN_Z);

    await regosVcrService.fiscalizeSale('sale-1');

    // Asked again rather than trusting a 'closed' answer as if it were 'open'.
    expect(client.zGetInfo).toHaveBeenCalledTimes(2);
  });

  it('does not touch the device when no shift is open', async () => {
    prismaMock.smena.findFirst.mockResolvedValueOnce(null);

    regosVcrService.start();
    await new Promise((r) => setTimeout(r, 0));

    expect(client.zGetInfo).not.toHaveBeenCalled();
  });

  it('survives a device that is not running yet', async () => {
    client.zGetInfo.mockRejectedValue(new VcrError(0, 'fetch failed', 'ZReport.GetInfo'));

    expect(() => regosVcrService.start()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));

    // The failed warm-up left the cache cold, so the sale asks for itself.
    client.zGetInfo.mockResolvedValue(OPEN_Z);
    await regosVcrService.fiscalizeSale('sale-1');
    expect(client.sale).toHaveBeenCalledTimes(1);
  });
});

describe('fiscalizeSale — timing', () => {
  it('records a phase breakdown that accounts for the whole fiscalization', async () => {
    await regosVcrService.fiscalizeSale('sale-1');

    const s = stats();
    for (const phase of ['queue', 'config', 'load', 'zreport', 'build', 'vcr-sale', 'persist']) {
      expect(s[`phase:${phase}`]?.count).toBe(1);
    }
    expect(s['phase:TOTAL'].count).toBe(1);

    // The phases must account for the whole thing — time that falls between marks would be time
    // the breakdown cannot explain, which is the one thing this instrumentation exists to avoid.
    const summed = Object.entries(s)
      .filter(([k]) => k.startsWith('phase:') && k !== 'phase:TOTAL')
      .reduce((total, [, v]) => total + v.totalMs, 0);
    expect(summed).toBeCloseTo(s['phase:TOTAL'].totalMs, -1);
  });

  it('measures the wait behind other receipts, not just the device', async () => {
    // Two fiscalizations started at once: the device is single-threaded, so the second waits. That
    // wait is invisible from inside the device and is what makes a receipt feel slow.
    client.sale.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(SALE_OK), 30)),
    );

    await Promise.all([
      regosVcrService.fiscalizeSale('sale-1'),
      regosVcrService.fiscalizeSale('sale-1'),
    ]);

    expect(stats()['phase:queue'].maxMs).toBeGreaterThan(20);
  });
});
