import { app, BrowserWindow, ipcMain } from "electron";
import { createWindow, createSetupWindow } from "./window";
import { setupIpcHandlers } from "./ipc/handlers";
import { setupSetupHandlers } from "./ipc/setup-handlers";
import { setupAutoUpdater } from "./updater/auto-updater";
import { autoUpdater } from "electron-updater";
import { SyncService } from "./sync/sync-service";
import { regosVcrService } from "./fiscal/regos-vcr-service";
import {
  initializeDatabase,
  readStoreBootstrap,
} from "./database/sqlite-client";
import { seedLocalDatabase } from "./database/seed";
import { getAppConfig, updateConfig } from "./config/app-config";
import { getPrismaClient } from "./database/sqlite-client";
import { getServerToken } from "./sync/queue-manager";
import { stopLocalServer, syncLocalServerWithMode } from "./local-server";
import { getCurrentUser } from "./ipc/auth-handlers";
import { log } from "./logger";

// Disable GPU acceleration — prevents renderer crash on remote desktop sessions
// (AnyDesk, RDP, TeamViewer) where no real GPU is available.
app.disableHardwareAcceleration();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  if (require("electron-squirrel-startup")) {
    app.quit();
  }
} catch {}

let mainWindow: BrowserWindow | null = null;
let setupWindow: BrowserWindow | null = null;
let syncService: SyncService | null = null;

function registerSyncHandlers(): void {
  ipcMain.handle("sync:getStatus", () => {
    const config = getAppConfig();
    return {
      ...(syncService?.getStatus() ?? {
        isSyncing: false,
        lastSyncTime: null,
        lastError: null,
      }),
      vpsApiUrl: config.vpsApiUrl,
    };
  });

  ipcMain.handle("sync:trigger", async () => {
    await syncService?.triggerSync();
  });

  ipcMain.handle("sync:unbackfillStock", async () => {
    const config = getAppConfig();
    const token = getServerToken();
    if (!token) return { error: "No server token — log in first" };
    const res = await fetch(`${config.vpsApiUrl}/sales/unbackfill-stock`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    return res.json();
  });

  ipcMain.handle("sync:diagnose", async () => {
    const config = getAppConfig();
    const prisma = getPrismaClient();
    const token = getServerToken();
    const currentUser = getCurrentUser();

    const [unsyncedCount, totalSales, localConfig, serverTokenSetting] =
      await Promise.all([
        prisma.sale.count({ where: { synced: false } }),
        prisma.sale.count(),
        prisma.localConfig.findUnique({ where: { id: "config" } }),
        prisma.systemSetting.findUnique({ where: { key: "server_token" } }),
      ]);

    let persistedTokenExpiry: string | null = null;
    if (serverTokenSetting?.value) {
      try {
        const parts = serverTokenSetting.value.split(".");
        const payload = JSON.parse(
          Buffer.from(parts[1], "base64").toString(),
        ) as { exp?: number; role?: string; storeId?: string };
        persistedTokenExpiry = payload.exp
          ? new Date(payload.exp * 1000).toISOString()
          : "no_expiry";
      } catch {
        persistedTokenExpiry = "invalid_token";
      }
    }

    const sampleUnsyncedSale = await prisma.sale.findFirst({
      where: { synced: false },
      include: { items: { take: 1 } },
      orderBy: { createdAt: "desc" },
    });

    return {
      currentUser: currentUser
        ? { phone: currentUser.phone, role: currentUser.role }
        : null,
      serverToken: {
        inMemory: !!token,
        persisted: !!serverTokenSetting?.value,
        persistedExpiry: persistedTokenExpiry,
      },
      sales: {
        total: totalSales,
        unsynced: unsyncedCount,
        sampleUnsynced: sampleUnsyncedSale
          ? {
              id: sampleUnsyncedSale.id,
              receiptNumber: sampleUnsyncedSale.receiptNumber,
              cashierId: sampleUnsyncedSale.cashierId,
              cashierName: sampleUnsyncedSale.cashierName,
              createdAt: sampleUnsyncedSale.createdAt,
              itemCount: sampleUnsyncedSale.items.length,
            }
          : null,
      },
      config: {
        vpsApiUrl: config.vpsApiUrl,
        storeId: config.storeId,
        terminalId: config.terminalId,
        localConfigStoreId: localConfig?.storeId ?? null,
        localConfigApiUrl: localConfig?.apiUrl ?? null,
      },
      lastSalesSync: syncService?.getStatus().lastSalesSync ?? null,
    };
  });
}

async function launchMainApp(): Promise<void> {
  const prisma = getPrismaClient();
  const localConfig = await prisma.localConfig.findUnique({
    where: { id: "config" },
  });
  if (localConfig) {
    updateConfig({
      terminalId: localConfig.terminalId,
      storeId: localConfig.storeId,
      vpsApiUrl: localConfig.apiUrl,
    });
    console.log(
      `[bootstrap] Loaded config: terminalId=${localConfig.terminalId} storeId=${localConfig.storeId}`,
    );
  }

  mainWindow = createWindow();

  if (mainWindow) {
    setupAutoUpdater(mainWindow);
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch(() => {
          /* offline */
        });
      }, 5000);
    });
  }

  syncService = new SyncService();
  syncService.start();

  // An OFFLINE_ONLY store's dashboard is served by this terminal on the shop's own network. The
  // listener is not worth failing startup over, so a bind error is recorded and shown in the QR
  // dialog rather than thrown here.
  void syncLocalServerWithMode().catch((err) =>
    console.error("[local-server] startup failed:", err),
  );

  // REGOS:VCR fiscalization startup (logs resolved config). The periodic background retry worker
  // was removed — fiscalization runs on new-sale, on shift close, and via the manual
  // "Fiscalise all old receipts" admin button.
  regosVcrService.start();
}

async function bootstrap() {
  try {
    // Initialize local SQLite database
    await initializeDatabase();

    // Register all IPC handlers once (sync handlers reference module-level syncService)
    setupIpcHandlers();
    registerSyncHandlers();

    process.on("unhandledRejection", (reason, promise) => {
      log.error("Unhandled Rejection at:", promise, "reason:", reason);
    });
    process.on("uncaughtException", (error) => {
      log.error("Uncaught Exception:", error);
    });

    log.info("[bootstrap] App started", {
      version: app.getVersion(),
      platform: process.platform,
    });

    const bootstrapStoreId = readStoreBootstrap();

    if (!bootstrapStoreId) {
      // First launch — no store configured. Show setup wizard.
      console.log(
        "[bootstrap] No store bootstrap found — launching setup wizard",
      );
      await seedLocalDatabase();

      setupSetupHandlers(
        () => setupWindow,
        async () => {
          await launchMainApp();
        },
      );

      setupWindow = createSetupWindow();
      return;
    }

    // Normal launch — store already configured
    await seedLocalDatabase();
    await launchMainApp();
  } catch (error) {
    console.error("Failed to start application:", error);
    app.quit();
  }
}

// Single-instance lock — quit immediately if another instance is already running
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = mainWindow ?? setupWindow;
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

// App lifecycle events
app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    syncService?.stop();
    regosVcrService.stop();
    void stopLocalServer();
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
  }
});

app.on("before-quit", () => {
  syncService?.stop();
  regosVcrService.stop();
  // Closing the listener stops the shop network being served by a terminal that is shutting down.
  void stopLocalServer();
});

export { mainWindow };
