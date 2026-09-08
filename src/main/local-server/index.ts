import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { join } from 'path';
import { app } from 'electron';
import { getPrismaClient } from '../database/sqlite-client';
import { getLanAddress } from '../network/lan-address';
import { verifyToken } from './auth';
import { buildRouter } from './routes';
import { StaticFiles } from './static-files';
import { HttpError, Router, sendError, sendJson, type RequestContext } from './router';

/**
 * The dashboard, served by the till itself.
 *
 * An OFFLINE_ONLY store has no VPS — but the dashboard never needed the VPS, only *an* API, and
 * the store's data is already here in SQLite. So the terminal serves both halves on the shop's
 * own Wi-Fi and the owner opens it on their phone with no internet at all.
 *
 * Only started for an OFFLINE_ONLY store. An ONLINE store's dashboard is the real one, backed by
 * the server that is authoritative for it; running a second, divergent copy against a local
 * replica would be a way to show people stale numbers.
 */

/** Same default as the QR builder in `../ipc/handlers.ts`, and the port Vite uses in dev. */
const DEFAULT_PORT = 5173;
const MAX_BODY_BYTES = 12 * 1024 * 1024; // Generous enough for a base64 invoice photo.

let server: Server | null = null;
let listeningPort: number | null = null;

export interface LocalServerStatus {
  running: boolean;
  port: number | null;
  address: string | null;
  url: string | null;
  error: string | null;
}

let lastError: string | null = null;

export function getLocalServerStatus(): LocalServerStatus {
  const address = getLanAddress();
  return {
    running: server !== null,
    port: listeningPort,
    address,
    url: server && address && listeningPort ? `http://${address}:${listeningPort}/web/` : null,
    error: lastError,
  };
}

/**
 * Where the built SPA lives. `asar: false`, so it is a plain directory in both dev and prod.
 *
 * `dist-web`, not `dist/web`: electron-builder excludes its own output directory (`dist`) from
 * the package, so `npm run build:web` stages a copy alongside `dist-renderer`.
 */
function webRoot(): string {
  return join(app.getAppPath(), 'dist-web');
}

async function resolvePort(): Promise<number> {
  const prisma = getPrismaClient();
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'local_web_port' } });
  const port = Number(setting?.value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}

/**
 * Start the server if this store is OFFLINE_ONLY, stop it otherwise.
 *
 * Safe to call repeatedly — on every launch and whenever a sync cycle reports a changed mode —
 * so flipping a store to OFFLINE_ONLY takes effect without a restart, and flipping it back
 * closes the listener rather than leaving the shop network served by a stale terminal.
 */
export async function syncLocalServerWithMode(): Promise<void> {
  const prisma = getPrismaClient();
  const config = await prisma.localConfig.findUnique({ where: { id: 'config' } });

  if (config?.mode === 'OFFLINE_ONLY') {
    await startLocalServer();
  } else {
    await stopLocalServer();
  }
}

export async function startLocalServer(): Promise<void> {
  if (server) return;

  const port = await resolvePort();
  const statics = new StaticFiles(webRoot());
  const router = buildRouter();
  const instance = createServer((req, res) => {
    handle(router, statics, req, res).catch(() => {
      if (!res.headersSent) sendError(res, 500, 'Internal error');
      else res.end();
    });
  });

  await new Promise<void>((resolve) => {
    instance.once('error', (err: NodeJS.ErrnoException) => {
      // Losing the dashboard must never take the till down with it, so a failure to bind is
      // recorded and surfaced in the QR dialog rather than thrown into app startup.
      lastError =
        err.code === 'EADDRINUSE'
          ? `Port ${port} is already in use on this computer.`
          : err.message;
      console.error(`[local-server] could not listen on ${port}: ${lastError}`);
      server = null;
      listeningPort = null;
      resolve();
    });

    // 0.0.0.0 on purpose: a phone reaches the till by its LAN address, so binding to loopback
    // would serve only the till itself.
    instance.listen(port, '0.0.0.0', () => {
      server = instance;
      listeningPort = port;
      lastError = null;
      console.log(`[local-server] dashboard on http://${getLanAddress() ?? '0.0.0.0'}:${port}/web/`);
      resolve();
    });
  });
}

export async function stopLocalServer(): Promise<void> {
  const instance = server;
  if (!instance) return;
  server = null;
  listeningPort = null;
  await new Promise<void>((resolve) => instance.close(() => resolve()));
}

async function handle(
  router: Router,
  statics: StaticFiles,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/web') {
    res.writeHead(302, { Location: '/web/' }).end();
    return;
  }

  if (pathname.startsWith('/web/')) {
    await statics.serve(res, pathname.slice('/web'.length));
    return;
  }

  if (pathname.startsWith('/api/')) {
    await handleApi(router, req, res, url);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
}

async function handleApi(
  router: Router,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const apiPath = url.pathname.slice('/api'.length) || '/';

  const matched = router.match(method, apiPath);
  if (!('route' in matched)) {
    if (matched.matchedPath) return sendError(res, 405, `Cannot ${method} ${apiPath}`);
    return sendError(res, 404, `Cannot ${method} ${apiPath}`);
  }

  const { route, params } = matched;

  try {
    const user = verifyToken(req.headers.authorization);
    if (!route.public) {
      // The SPA's axios interceptor turns a 401 into a logout and a redirect to the login page,
      // which is exactly right for an expired token on a phone left open overnight.
      if (!user) return sendError(res, 401, 'Unauthorized');
      if (route.roles && !route.roles.includes(user.role)) {
        return sendError(res, 403, 'Access denied');
      }
    }

    const ctx: RequestContext = {
      params,
      query: Object.fromEntries(url.searchParams),
      body: await readJsonBody(req),
      user: user ?? undefined,
      req,
    };

    const result = await route.handler(ctx);
    sendJson(res, method === 'POST' ? 201 : 200, result);
  } catch (err) {
    if (err instanceof HttpError) return sendError(res, err.status, err.message);
    // Never let an internal message reach the network — it can carry file paths or SQL.
    console.error(`[local-server] ${method} ${apiPath} failed:`, err);
    sendError(res, 500, 'Internal error');
  }
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') return {};

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // Refuse rather than buffer an unbounded upload into the till's memory.
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
