import type { IncomingMessage, ServerResponse } from 'http';

/**
 * A very small HTTP router.
 *
 * The dashboard talks to a NestJS server in the normal ONLINE deployment; offline it talks to
 * this. Rather than boot Nest inside Electron — its controllers are bound to the PostgreSQL
 * client and a multi-tenant schema neither of which exists here — the handful of things Nest was
 * providing (path params, JSON bodies, guards, status codes) are done directly.
 */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestContext {
  /** Path parameters, e.g. `:id` in `/products/:id`. */
  params: Record<string, string>;
  /** Parsed query string. Repeated keys keep the last value, matching Express. */
  query: Record<string, string>;
  /** Parsed JSON body, or `{}` for a request without one. */
  body: any;
  /** The authenticated user, absent on a `public` route. */
  user?: AuthenticatedUser;
  req: IncomingMessage;
}

export interface AuthenticatedUser {
  id: string;
  phone: string;
  role: string;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

export interface Route {
  method: Method;
  /** Pattern with `:name` placeholders, e.g. `/products/:id`. */
  path: string;
  handler: Handler;
  /** Skip the auth guard. Only login and other pre-auth endpoints set this. */
  public?: boolean;
  /** Restrict to these roles. Omitted means any authenticated user. */
  roles?: string[];
}

/**
 * An error carrying the status the client should see.
 *
 * Anything else thrown by a handler becomes a 500 with a generic message, so an internal failure
 * cannot leak a stack trace or a file path onto the shop's network.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = 'Unauthorized') => new HttpError(401, m);
export const forbidden = (m = 'Access denied') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
/** For endpoints that exist but cannot work without the VPS — the UI shows the reason. */
export const unavailable = (m: string) => new HttpError(503, m);

interface CompiledRoute extends Route {
  segments: string[];
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(routes: Route[]): this {
    for (const route of routes) {
      this.routes.push({ ...route, segments: split(route.path) });
    }
    return this;
  }

  /**
   * Find the route for a request.
   *
   * Returns `matchedPath: false` when no route has this path at all (a 404) and true when the
   * path exists under a different method (a 405) — the distinction the SPA needs to tell "you
   * built an old client" from "you called it wrong".
   */
  match(
    method: string,
    pathname: string,
  ): { route: CompiledRoute; params: Record<string, string> } | { matchedPath: boolean } {
    const segments = split(pathname);
    let matchedPath = false;

    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (!params) continue;
      matchedPath = true;
      if (route.method === method) return { route, params };
    }

    return { matchedPath };
  }
}

function split(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Match a compiled pattern against a request path, returning its params or null. */
function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const expected = pattern[i];
    if (expected.startsWith(':')) {
      // A path parameter arrives percent-encoded; a barcode or MXIK code may legitimately
      // contain characters that need it.
      params[expected.slice(1)] = safeDecode(actual[i]);
      continue;
    }
    if (expected !== actual[i]) return null;
  }
  return params;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A malformed escape is not worth a 400 — pass the raw segment through.
    return value;
  }
}

/** Write a JSON response. `undefined` from a handler becomes 204, matching Nest's behaviour. */
export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (payload === undefined) {
    res.writeHead(204).end();
    return;
  }
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Nest's error envelope, which the SPA's axios interceptor reads `message` out of. */
export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { statusCode: status, message });
}
