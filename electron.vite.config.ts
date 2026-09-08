import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Load .env.pos so values are baked into the production bundle. In dev, electron-vite injects
  // these automatically; in the packaged app process.env is bare Node.js — without define, all
  // vars would be undefined/default.
  //
  // The mode is 'pos', not Vite's own mode. It used to be `mode || 'pos'`, but electron-vite
  // always supplies a mode ('development'/'production'), so the fallback never fired and
  // `.env.pos` was never read — every value here came from the root `.env`, which is the SERVER's
  // config. That is why editing `.env.pos` appeared to do nothing, and how a PostgreSQL URL
  // (complete with its password) ended up baked into the terminal bundle.
  const env = loadEnv('pos', process.cwd(), '')

  // DATABASE_URL is deliberately absent. The terminal derives its own SQLite path from userData
  // at runtime (`sqlite-client.ts`) and passes it to Prisma explicitly, so a baked value is never
  // read — it only ever served to freeze a stale connection string, with any credentials in it,
  // into a file shipped to customers.
  const APP_ENV_KEYS = [
    'VPS_API_URL', 'TERMINAL_ID', 'STORE_ID', 'STORE_NAME',
    'JWT_SECRET', 'PRINTER_NAME', 'PRINTER_TYPE', 'SYNC_INTERVAL_MS', 'RETRY_INTERVAL_MS',
  ]
  const envDefines = Object.fromEntries(
    APP_ENV_KEYS
      .filter(k => env[k] !== undefined)
      .map(k => [`process.env.${k}`, JSON.stringify(env[k])])
  )

  // electron-vite@5 types use BuildEnvironmentOptions (Vite 6 only); cast to avoid mismatch with Vite 5
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
  main: {
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/index.ts'),
      },
    },
    define: envDefines,
  },

  preload: {
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: resolve(__dirname, 'src/main/preload.ts'),
      },
    },
  },

  renderer: {
    publicDir: resolve(__dirname, 'public'),
    server: {
      port: 5400,
    },
    build: {
      outDir: 'dist-renderer'
    },
    plugins: [
      {
        // Electron file:// + crossorigin on <script type="module"> blocks execution silently.
        name: 'remove-crossorigin',
        transformIndexHtml(html: string) {
          return html.replace(/ crossorigin/g, '')
        },
      },
    ],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main'),
      }
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
})
