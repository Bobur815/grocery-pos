import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { join, normalize, extname, sep } from 'path';
import type { ServerResponse } from 'http';

/**
 * Serves the built web dashboard.
 *
 * The SPA is built with Vite's `base: '/web/'`, so its own asset URLs are absolute `/web/...`
 * paths. Serving it under that same prefix is what lets the identical bundle be served either by
 * the NestJS server in production or by this one offline, with no rebuild and no client change.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

export class StaticFiles {
  constructor(private readonly root: string) {}

  /**
   * Serve `pathname` (already stripped of the `/web` prefix).
   *
   * Anything that is not a real file falls back to `index.html`, because the dashboard uses
   * BrowserRouter — a phone opening `/web/reports/daily` directly must still get the app shell.
   * A missing hashed asset must NOT fall back, though: handing back HTML for a `.js` request
   * produces a blank page and a confusing MIME error instead of an honest 404.
   */
  async serve(res: ServerResponse, pathname: string): Promise<void> {
    const resolved = this.resolve(pathname);

    if (resolved) {
      const info = await statFile(resolved);
      if (info) return this.send(res, resolved, info.size);
    }

    // A request that looks like a file — it has an extension — is a genuine miss.
    if (extname(pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }

    const index = join(this.root, 'index.html');
    const info = await statFile(index);
    if (!info) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end('The dashboard is not installed on this terminal.');
      return;
    }
    this.send(res, index, info.size, true);
  }

  /**
   * Map a URL path to a file inside the root, or null if it escapes.
   *
   * This server is on the shop network, so `../` traversal would expose the whole filesystem.
   * Normalising and then re-checking the prefix is what keeps a request inside the bundle.
   */
  private resolve(pathname: string): string | null {
    const relative = normalize(decodeSafe(pathname)).replace(/^([/\\])+/, '');
    const full = join(this.root, relative);
    const rootWithSep = this.root.endsWith(sep) ? this.root : this.root + sep;
    if (full !== this.root && !full.startsWith(rootWithSep)) return null;
    return full;
  }

  private send(res: ServerResponse, file: string, size: number, noStore = false): void {
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': size,
      // Vite fingerprints asset filenames, so they can be cached hard; index.html must not be,
      // or an updated terminal keeps serving the previous build's asset references.
      'Cache-Control': noStore ? 'no-store' : 'public, max-age=31536000, immutable',
    });
    createReadStream(file).pipe(res);
  }
}

async function statFile(path: string): Promise<{ size: number } | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? { size: info.size } : null;
  } catch {
    return null;
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
