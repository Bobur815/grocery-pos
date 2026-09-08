import { cpSync, existsSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

/**
 * Stage the built web dashboard where electron-builder can package it.
 *
 * `src/web` builds to `dist/web` because that is where the NestJS server expects it (it serves
 * `dist/server/../web`, and the Dockerfile copies the whole `dist` tree). But `dist` is also
 * electron-builder's own output directory, which it excludes from `files` to avoid packaging its
 * own installers — so the Electron build reads the dashboard from `dist-web` instead, alongside
 * the existing `dist-renderer` and `dist-electron`.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'dist', 'web');
const to = join(root, 'dist-web');

if (!existsSync(from)) {
  console.error(`[stage-web] ${from} does not exist — run the src/web build first.`);
  process.exit(1);
}

// Remove first: a stale hashed asset left behind would still be packaged, bloating the installer
// with files no index.html references.
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });

console.log(`[stage-web] staged ${from} -> ${to}`);
