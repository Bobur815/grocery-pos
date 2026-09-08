import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import type { ServerResponse } from 'http';

import { StaticFiles } from './static-files';

/** Enough of a ServerResponse for the static handler, capturing what it writes. */
function fakeResponse() {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (c) => chunks.push(c as Buffer));

  const res = stream as unknown as ServerResponse & {
    status?: number;
    headers?: Record<string, unknown>;
  };
  res.writeHead = ((status: number, headers?: Record<string, unknown>) => {
    (res as any).status = status;
    (res as any).headers = headers;
    return res;
  }) as never;

  return {
    res,
    done: () => new Promise<void>((resolve) => stream.on('end', () => resolve())),
    get status() {
      return (res as any).status as number;
    },
    get headers() {
      return ((res as any).headers ?? {}) as Record<string, string>;
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8');
    },
  };
}

let root: string;
let statics: StaticFiles;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'posgro-web-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'style-abc123.css'), 'body{}');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));
beforeEach(() => {
  statics = new StaticFiles(root);
});

describe('StaticFiles', () => {
  it('serves a hashed asset with its own content type', async () => {
    const out = fakeResponse();
    await statics.serve(out.res, '/assets/index-abc123.js');
    await out.done();
    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toBe('text/javascript; charset=utf-8');
    expect(out.body).toBe('console.log(1)');
  });

  // Vite fingerprints asset names, so they are safe to cache forever.
  it('caches a hashed asset hard', async () => {
    const out = fakeResponse();
    await statics.serve(out.res, '/assets/style-abc123.css');
    await out.done();
    expect(out.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
  });

  // BrowserRouter: a phone opening a deep link directly must still get the app shell.
  it('falls back to index.html for an app route', async () => {
    const out = fakeResponse();
    await statics.serve(out.res, '/reports/daily');
    await out.done();
    expect(out.status).toBe(200);
    expect(out.body).toContain('id="root"');
  });

  it('never caches index.html, so an updated build is picked up', async () => {
    const out = fakeResponse();
    await statics.serve(out.res, '/');
    await out.done();
    expect(out.headers['Cache-Control']).toBe('no-store');
  });

  // Falling back to HTML for a missing script gives a blank page and a MIME error instead of
  // saying what actually went wrong.
  it('404s a missing asset rather than serving HTML for it', async () => {
    const out = fakeResponse();
    await statics.serve(out.res, '/assets/index-gone.js');
    await out.done();
    expect(out.status).toBe(404);
    expect(out.body).not.toContain('<!doctype html>');
  });

  // This server listens on the shop network; traversal would expose the whole filesystem.
  it.each([
    ['../../../etc/passwd'],
    ['/../../package.json'],
    ['/assets/../../package.json'],
    ['/%2e%2e/%2e%2e/package.json'],
  ])('refuses to escape the web root via %s', async (path) => {
    const out = fakeResponse();
    await statics.serve(out.res, path);
    await out.done();
    // Either a plain 404, or the SPA shell — never a file from outside the root.
    expect(out.body).not.toContain('"name": "posgro"');
  });

  it('reports plainly when the dashboard was never built', async () => {
    const empty = new StaticFiles(join(root, 'does-not-exist'));
    const out = fakeResponse();
    await empty.serve(out.res, '/');
    await out.done();
    expect(out.status).toBe(503);
    expect(out.body).toMatch(/not installed/i);
  });
});
