import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';
import { getAppConfig } from '../config/app-config';
import { getPrismaClient } from '../database/sqlite-client';
import { forbidden, unauthorized, type AuthenticatedUser } from './router';

/**
 * Authentication for the LAN dashboard.
 *
 * This binds to the shop's network, so the terminal's whole database is one unauthenticated
 * request away from anyone on the same Wi-Fi. Every route except login is guarded.
 *
 * Deliberately separate from `auth:login` in `../ipc/auth-handlers.ts`: that flow falls back to
 * the VPS, arms the global server token and sets the POS's own session — all side effects that
 * have no business firing because someone opened a page on their phone. The parts worth sharing
 * are the ones shared here: the same `users` table, the same bcrypt hashes.
 */

/**
 * Marks a token as minted for the LAN dashboard.
 *
 * Tokens for the POS session are signed with the same secret, so without an audience a POS token
 * would authenticate a browser and vice versa. They have different lifetimes and different threat
 * models, so they are kept distinct.
 */
const AUDIENCE = 'posgro-local-web';
const TOKEN_TTL = '12h';

interface TokenPayload {
  sub: string;
  phone: string;
  role: string;
}

function secret(): string {
  return getAppConfig().jwtSecret || 'local-secret-key';
}

export function signToken(user: TokenPayload): string {
  return jwt.sign({ sub: user.sub, phone: user.phone, role: user.role }, secret(), {
    audience: AUDIENCE,
    expiresIn: TOKEN_TTL,
  });
}

/** The user a request is acting as, or null when the token is missing, foreign or expired. */
export function verifyToken(header: string | undefined): AuthenticatedUser | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? '');
  if (!match) return null;
  try {
    const payload = jwt.verify(match[1], secret(), { audience: AUDIENCE }) as jwt.JwtPayload;
    if (!payload.sub || typeof payload.role !== 'string') return null;
    return { id: String(payload.sub), phone: String(payload.phone ?? ''), role: payload.role };
  } catch {
    return null;
  }
}

/**
 * Throttle password guessing.
 *
 * The dashboard's login form is reachable by anyone on the shop Wi-Fi, and store PINs and
 * passwords are short. Counted per phone number rather than per IP: a phone hopping between
 * Wi-Fi and mobile data changes IP, and the account is what actually needs protecting.
 */
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 5 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function throttleKey(phone: string): string {
  return phone.trim().toLowerCase();
}

function checkThrottle(phone: string): void {
  const entry = attempts.get(throttleKey(phone));
  if (!entry) return;
  if (Date.now() - entry.firstAt > LOCKOUT_MS) {
    attempts.delete(throttleKey(phone));
    return;
  }
  if (entry.count >= MAX_ATTEMPTS) {
    throw unauthorized('Too many failed attempts. Try again in a few minutes.');
  }
}

function recordFailure(phone: string): void {
  const key = throttleKey(phone);
  const entry = attempts.get(key);
  if (!entry || Date.now() - entry.firstAt > LOCKOUT_MS) {
    attempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
}

function clearFailures(phone: string): void {
  attempts.delete(throttleKey(phone));
}

/** Everything the dashboard shows about the signed-in user. Never includes the password hash. */
export function publicUser(user: {
  id: string;
  phone: string;
  role: string;
  nameUz: string;
  nameRu: string;
  active: boolean;
  storeId: string | null;
}) {
  return {
    id: user.id,
    phone: user.phone,
    role: user.role,
    nameUz: user.nameUz,
    nameRu: user.nameRu,
    active: user.active,
    storeId: user.storeId,
  };
}

/**
 * Check a phone and password against the local `users` table.
 *
 * Purely local — there is no VPS to fall back to, which is the whole premise of this server. A
 * password changed on the web dashboard while the store was online is already mirrored into the
 * local hash by `auth:login`, so an offline store logs in with whatever it last used.
 */
export async function authenticate(phone: string, password: string) {
  checkThrottle(phone);

  const prisma = getPrismaClient();
  const user = await prisma.user.findUnique({ where: { phone } });

  // One message for "no such user" and "wrong password" alike — telling them apart tells an
  // attacker on the shop Wi-Fi which phone numbers are worth guessing against.
  if (!user || !(await bcrypt.compare(password, user.password))) {
    recordFailure(phone);
    throw unauthorized('Invalid phone or password');
  }
  if (!user.active) {
    throw forbidden('This account is deactivated');
  }

  clearFailures(phone);
  return user;
}

/** Guard for routes only an admin may reach. */
export function requireRole(user: AuthenticatedUser | undefined, roles: string[]): void {
  if (!user) throw unauthorized();
  if (!roles.includes(user.role)) throw forbidden();
}
