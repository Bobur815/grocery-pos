import type { PrismaClient } from '../../generated/prisma-sqlite';
import { getPrismaClient } from '../database/sqlite-client';
import { badRequest } from './router';

/**
 * Shared bits for the local API routes.
 *
 * The guiding rule for every route in `./routes`: mirror the NestJS **service**, not the Electron
 * IPC handler that happens to run the same query. The IPC handlers serialize for the POS
 * renderer — Decimals to numbers, `active` renamed to `isActive`, `undefined` where the server
 * sends `null` — and the dashboard was built against the server's wire format, not that one.
 *
 * Returning raw Prisma rows gets this right for free: a Prisma `Decimal` serializes to a JSON
 * string on both providers, which is exactly what the dashboard already parses.
 */

/**
 * The database, properly typed.
 *
 * `getPrismaClient()` is `any` — it resolves the generated client through a runtime `require`, so
 * TypeScript sees nothing. A type-only import gives these routes real field checking (it is
 * erased at compile time, so the client still is not bundled), which for handlers writing money
 * and stock is worth the cast.
 */
export const db = (): PrismaClient => getPrismaClient() as PrismaClient;

/** Parse a query-string boolean the way Nest's ParseBoolPipe does. Absent stays undefined. */
export function boolParam(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return undefined;
}

export function intParam(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

export function numberParam(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse an ISO date or `YYYY-MM-DD`. Rejects rubbish rather than silently querying epoch. */
export function dateParam(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw badRequest(`Invalid ${field}`);
  return date;
}

/**
 * A `YYYY-MM-DD` end date means "up to the end of that day".
 *
 * The dashboard's date pickers send bare dates; treating one as midnight would silently drop
 * every sale made on the last day of the range.
 */
export function endOfDayParam(value: string | undefined, field: string): Date | undefined {
  const date = dateParam(value, field);
  if (!date) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value!)) date.setHours(23, 59, 59, 999);
  return date;
}

/** Require a field on a request body, with the message shape Nest's validation pipe produces. */
export function required<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null || value === '') {
    throw badRequest(`${field} should not be empty`);
  }
  return value;
}

export function isAdmin(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
}
