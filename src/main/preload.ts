import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  // Authentication
  auth: {
    login: (phone: string, password: string) =>
      ipcRenderer.invoke("auth:login", phone, password),
    loginWithPin: (pin: string) => ipcRenderer.invoke("auth:loginWithPin", pin),
    logout: () => ipcRenderer.invoke("auth:logout"),
    getProfile: () => ipcRenderer.invoke("auth:getProfile"),
    restoreSession: (token: string) =>
      ipcRenderer.invoke("auth:restoreSession", token),
    changePassword: (currentPassword: string, newPassword: string) =>
      ipcRenderer.invoke("auth:changePassword", currentPassword, newPassword),
    isPinConfigured: () => ipcRenderer.invoke("auth:isPinConfigured"),
    setupPin: (pin: string) => ipcRenderer.invoke("auth:setupPin", pin),
  },

  // Products
  products: {
    getAll: (filters?: { categoryId?: string; active?: boolean }) =>
      ipcRenderer.invoke("products:getAll", filters),
    getById: (id: string, opts?: { byDbId?: boolean }) =>
      ipcRenderer.invoke("products:getById", id, opts),
    getByBarcode: (barcode: string) =>
      ipcRenderer.invoke("products:getByBarcode", barcode),
    findByInternalCode: (internalCode: string) =>
      ipcRenderer.invoke("products:findByInternalCode", internalCode),
    getNextInternalCode: () =>
      ipcRenderer.invoke("products:getNextInternalCode"),
    create: (data: unknown) => ipcRenderer.invoke("products:create", data),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("products:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("products:delete", id),
    search: (query: string) => ipcRenderer.invoke("products:search", query),
    getTopSelling: (limit?: number) =>
      ipcRenderer.invoke("products:getTopSelling", limit),
    getAnalytics: (productId: number, startDate?: string, endDate?: string) =>
      ipcRenderer.invoke(
        "products:getAnalytics",
        productId,
        startDate,
        endDate,
      ),
  },

  // Sales
  sales: {
    create: (data: unknown) => ipcRenderer.invoke("sales:create", data),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("sales:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("sales:delete", id),
    getAll: (filters?: {
      startDate?: string;
      endDate?: string;
      terminalId?: string;
    }) => ipcRenderer.invoke("sales:getAll", filters),
    getById: (id: string) => ipcRenderer.invoke("sales:getById", id),
    getTodaySummary: () => ipcRenderer.invoke("sales:getTodaySummary"),
  },

  // Users (Admin only)
  users: {
    getAll: () => ipcRenderer.invoke("users:getAll"),
    create: (data: unknown) => ipcRenderer.invoke("users:create", data),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("users:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("users:delete", id),
  },

  // Categories
  categories: {
    getAll: () => ipcRenderer.invoke("categories:getAll"),
    getTopSelling: (limit?: number) =>
      ipcRenderer.invoke("categories:getTopSelling", limit),
    create: (data: unknown) => ipcRenderer.invoke("categories:create", data),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("categories:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("categories:delete", id),
  },

  // MXIK catalog (proxied to VPS)
  mxik: {
    getGroups: () => ipcRenderer.invoke("mxik:getGroups"),
    getPackages: (mxikCode: string) => ipcRenderer.invoke("mxik:getPackages", mxikCode),
    lookupByBarcode: (barcode: string) => ipcRenderer.invoke("mxik:lookupByBarcode", barcode),
    catalogSearch: (q: string, page = 0, size = 10) =>
      ipcRenderer.invoke("mxik:catalogSearch", q, page, size),
  },

  // REGOS:VCR fiscalization
  fiscal: {
    getConfig: () => ipcRenderer.invoke("fiscal:getConfig"),
    setConfig: (input: unknown) => ipcRenderer.invoke("fiscal:setConfig", input),
    testConnection: () => ipcRenderer.invoke("fiscal:testConnection"),
    getStatus: () => ipcRenderer.invoke("fiscal:getStatus"),
    fiscalizeOld: () => ipcRenderer.invoke("fiscal:fiscalizeOld"),
    onBulkProgress: (
      cb: (p: import("../shared/types/fiscal.types").FiscalBulkProgress) => void,
    ) => {
      const h = (
        _e: IpcRendererEvent,
        p: import("../shared/types/fiscal.types").FiscalBulkProgress,
      ) => cb(p);
      ipcRenderer.on("fiscal:bulkProgress", h);
      return () => ipcRenderer.removeListener("fiscal:bulkProgress", h);
    },
    retrySale: (saleId: string) => ipcRenderer.invoke("fiscal:retrySale", saleId),
    previewPayload: (saleId: string) => ipcRenderer.invoke("fiscal:previewPayload", saleId),
    refund: (saleId: string) => ipcRenderer.invoke("fiscal:refund", saleId),
    printDuplicate: (saleId: string) => ipcRenderer.invoke("fiscal:printDuplicate", saleId),
    zInfo: () => ipcRenderer.invoke("fiscal:zInfo"),
    zOpen: () => ipcRenderer.invoke("fiscal:zOpen"),
    zClose: () => ipcRenderer.invoke("fiscal:zClose"),
  },

  // Inventory
  inventory: {
    createArrival: (data: unknown) =>
      ipcRenderer.invoke("inventory:createArrival", data),
    getArrivals: (filters?: { productId?: string }) =>
      ipcRenderer.invoke("inventory:getArrivals", filters),
    getLowStock: () => ipcRenderer.invoke("inventory:getLowStock"),
  },

  // Suppliers
  suppliers: {
    getAll: (includeInactive?: boolean) =>
      ipcRenderer.invoke("suppliers:getAll", includeInactive),
    getById: (id: string) => ipcRenderer.invoke("suppliers:getById", id),
    create: (data: unknown) => ipcRenderer.invoke("suppliers:create", data),
    update: (id: string, data: unknown) =>
      ipcRenderer.invoke("suppliers:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("suppliers:delete", id),
    getTransactions: (filters?: unknown) =>
      ipcRenderer.invoke("suppliers:getTransactions", filters),
    createTransaction: (data: unknown) =>
      ipcRenderer.invoke("suppliers:createTransaction", data),
    updateTransaction: (id: string, data: unknown) =>
      ipcRenderer.invoke("suppliers:updateTransaction", id, data),
    deleteTransaction: (id: string) =>
      ipcRenderer.invoke("suppliers:deleteTransaction", id),
    getBalance: (supplierId: string) =>
      ipcRenderer.invoke("suppliers:getBalance", supplierId),
    recordPayment: (data: unknown) =>
      ipcRenderer.invoke("suppliers:recordPayment", data),
  },

  // Sync
  sync: {
    trigger: () => ipcRenderer.invoke("sync:trigger"),
    getStatus: () => ipcRenderer.invoke("sync:getStatus"),
    diagnose: () => ipcRenderer.invoke("sync:diagnose"),
    unbackfillStock: () => ipcRenderer.invoke("sync:unbackfillStock"),
    onCompleted: (callback: () => void) => {
      ipcRenderer.on("sync:completed", callback);
      return () => ipcRenderer.removeListener("sync:completed", callback);
    },
    onFailed: (callback: (error: { message: string }) => void) => {
      const handler = (_event: IpcRendererEvent, error: { message: string }) =>
        callback(error);
      ipcRenderer.on("sync:failed", handler);
      return () => ipcRenderer.removeListener("sync:failed", handler);
    },
    onStockConflict: (
      callback: (
        conflicts: { id: number; nameRu: string; stock: number }[],
      ) => void,
    ) => {
      const handler = (
        _event: IpcRendererEvent,
        conflicts: { id: number; nameRu: string; stock: number }[],
      ) => callback(conflicts);
      ipcRenderer.on("sync:stockConflict", handler);
      return () => ipcRenderer.removeListener("sync:stockConflict", handler);
    },
  },

  // Printer
  printer: {
    printReceipt: (saleId: string) =>
      ipcRenderer.invoke("printer:printReceipt", saleId),
    testPrint: () => ipcRenderer.invoke("printer:testPrint"),
    getAvailablePrinters: () => ipcRenderer.invoke("printer:getAvailable"),
    printPriceTags: (html: string, widthMm: number, heightMm: number) =>
      ipcRenderer.invoke("printer:printPriceTags", html, widthMm, heightMm),
    printWeightedLabel: (data: unknown) =>
      ipcRenderer.invoke("printer:printWeightedLabel", data),
    printPriceTagsTSPL: (req: unknown) =>
      ipcRenderer.invoke("printer:printPriceTagsTSPL", req),
    openCashDrawer: () => ipcRenderer.invoke("printer:openCashDrawer"),
    testOpenCashDrawer: () => ipcRenderer.invoke("printer:testOpenCashDrawer"),
  },

  // Pre-weighed items
  weighedItems: {
    create: (data: unknown) => ipcRenderer.invoke("weighedItems:create", data),
    findByBarcode: (barcode: string) =>
      ipcRenderer.invoke("weighedItems:findByBarcode", barcode),
    markAsSold: (id: string, saleId?: string) =>
      ipcRenderer.invoke("weighedItems:markAsSold", id, saleId),
    getAvailable: (productId: number) =>
      ipcRenderer.invoke("weighedItems:getAvailable", productId),
    getAll: (filters?: unknown) =>
      ipcRenderer.invoke("weighedItems:getAll", filters),
    delete: (id: string) => ipcRenderer.invoke("weighedItems:delete", id),
  },

  // Label Scale (Rongta RLS)
  scale: {
    testConnection: () => ipcRenderer.invoke("scale:testConnection"),
    syncProduct: (productId: number) =>
      ipcRenderer.invoke("scale:syncProduct", productId),
    syncAll: () => ipcRenderer.invoke("scale:syncAll"),
    updateConfig: (ip: string, port: number) =>
      ipcRenderer.invoke("scale:updateConfig", ip, port),
    getConfig: () => ipcRenderer.invoke("scale:getConfig"),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke("settings:set", key, value),
    getAll: () => ipcRenderer.invoke("settings:getAll"),
  },

  // Receipt scanning
  receipt: {
    scan: (imageBase64: string, mimeType: string) =>
      ipcRenderer.invoke("receipt:scan", imageBase64, mimeType),
    matchProducts: (items: { name: string; mxik?: string | null }[]) =>
      ipcRenderer.invoke("receipt:matchProducts", items),
    getPlan: () => ipcRenderer.invoke("receipt:getPlan"),
    getScanUsage: () => ipcRenderer.invoke("receipt:getScanUsage"),
  },

  // Analytics
  analytics: {
    getData: (filters: {
      startDate: string;
      endDate: string;
      terminalId?: string;
    }) => ipcRenderer.invoke("analytics:getData", filters),
  },

  // Terminals
  terminals: {
    getKnown: () => ipcRenderer.invoke("terminals:getKnown"),
    getStatus: () => ipcRenderer.invoke("terminals:getStatus"),
  },

  // App info
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion"),
    isOnline: (): Promise<boolean> => ipcRenderer.invoke("app:isOnline"),
    getTerminalId: () => ipcRenderer.invoke("app:getTerminalId"),
    getStoreInfo: () => ipcRenderer.invoke("app:getStoreInfo"),
    quit: () => ipcRenderer.invoke("app:quit"),
    relaunch: () => ipcRenderer.invoke("app:relaunch"),
    onCloseRequested: (callback: () => void) => {
      ipcRenderer.on("app:close-requested", callback);
      return () => ipcRenderer.removeListener("app:close-requested", callback);
    },
    confirmClose: () => ipcRenderer.send("app:confirm-close"),
  },

  // Local config (VPS connection settings)
  config: {
    getLocalConfig: () => ipcRenderer.invoke("config:getLocalConfig"),
    updateLocalConfig: (data: {
      storeId?: string;
      apiUrl?: string;
      storeName?: string;
      terminalId?: string;
    }) => ipcRenderer.invoke("config:updateLocalConfig", data),
  },

  // Smena (shift) management
  smena: {
    getCurrent: () => ipcRenderer.invoke("smena:getCurrent"),
    open: (data: { initialCash: number }) =>
      ipcRenderer.invoke("smena:open", data),
    addMovement: (data: {
      smenaId: string;
      type: "PAY_IN" | "PAY_OUT";
      amount: number;
      note?: string;
    }) => ipcRenderer.invoke("smena:addMovement", data),
    close: (data: { smenaId: string; finalCash: number }) =>
      ipcRenderer.invoke("smena:close", data),
    printZReport: (smenaId: string) =>
      ipcRenderer.invoke("smena:printZReport", smenaId),
    printXReport: (smenaId: string) =>
      ipcRenderer.invoke("smena:printXReport", smenaId),
    getHistory: (filters?: { limit?: number }) =>
      ipcRenderer.invoke("smena:getHistory", filters),
  },

  // Setup wizard (first-launch only)
  setup: {
    authenticate: (data: {
      phone: string;
      password: string;
      storeId: string;
    }) => ipcRenderer.invoke("setup:authenticate", data),
    complete: (data: {
      storeId: string;
      terminalId: string;
      storeName: string;
      storeAddress: string;
      storePhone: string;
      storeStir: string;
      taxRate: string;
      syncInterval: string;
      token: string;
      pin?: string;
    }) => ipcRenderer.invoke("setup:complete", data),
    launchApp: () => ipcRenderer.invoke("setup:launchApp"),
  },

  // Auto-updater
  updater: {
    checkForUpdates: () => ipcRenderer.invoke("updater:checkForUpdates"),
    startDownload: () => ipcRenderer.invoke("updater:startDownload"),
    cancelDownload: () => ipcRenderer.invoke("updater:cancelDownload"),
    quitAndInstall: () => ipcRenderer.invoke("updater:quitAndInstall"),
    onChecking: (cb: () => void) => {
      ipcRenderer.on("updater:checking", cb);
      return () => ipcRenderer.removeListener("updater:checking", cb);
    },
    onAvailable: (
      cb: (info: { version: string; releaseDate: string }) => void,
    ) => {
      const h = (
        _e: IpcRendererEvent,
        i: { version: string; releaseDate: string },
      ) => cb(i);
      ipcRenderer.on("updater:available", h);
      return () => ipcRenderer.removeListener("updater:available", h);
    },
    onNotAvailable: (cb: () => void) => {
      ipcRenderer.on("updater:not-available", cb);
      return () => ipcRenderer.removeListener("updater:not-available", cb);
    },
    onProgress: (
      cb: (p: {
        percent: number;
        transferred: number;
        total: number;
        bytesPerSecond: number;
      }) => void,
    ) => {
      const h = (
        _e: IpcRendererEvent,
        p: {
          percent: number;
          transferred: number;
          total: number;
          bytesPerSecond: number;
        },
      ) => cb(p);
      ipcRenderer.on("updater:progress", h);
      return () => ipcRenderer.removeListener("updater:progress", h);
    },
    onDownloaded: (cb: (info: { version: string }) => void) => {
      const h = (_e: IpcRendererEvent, i: { version: string }) => cb(i);
      ipcRenderer.on("updater:downloaded", h);
      return () => ipcRenderer.removeListener("updater:downloaded", h);
    },
    onError: (cb: (e: { message: string }) => void) => {
      const h = (_e: IpcRendererEvent, e: { message: string }) => cb(e);
      ipcRenderer.on("updater:error", h);
      return () => ipcRenderer.removeListener("updater:error", h);
    },
    onCancelled: (cb: () => void) => {
      ipcRenderer.on("updater:cancelled", cb);
      return () => ipcRenderer.removeListener("updater:cancelled", cb);
    },
  },

  // Marking codes — prevent re-sale of group 022 unique QR scans
  markingCodes: {
    check: (code: string) =>
      ipcRenderer.invoke("markingCodes:check", code),
    record: (entries: { code: string; productBarcode?: string }[]) =>
      ipcRenderer.invoke("markingCodes:record", entries),
    removeForSale: (saleId: string) =>
      ipcRenderer.invoke("markingCodes:removeForSale", saleId),
  },

  // Marking check — staff-facing registry lookup for a single DataMatrix (/marking-check)
  markingCheck: {
    verify: (code: string) => ipcRenderer.invoke("markingCheck:verify", code),
    apiKeyStatus: () => ipcRenderer.invoke("markingCheck:apiKeyStatus"),
    setApiKey: (key: string) => ipcRenderer.invoke("markingCheck:setApiKey", key),
  },

  // Logger — forwards renderer errors to the main-process electron-log file
  logger: {
    error: (msg: string) => ipcRenderer.send("log:renderer", "error", msg),
    warn: (msg: string) => ipcRenderer.send("log:renderer", "warn", msg),
    info: (msg: string) => ipcRenderer.send("log:renderer", "info", msg),
  },
});

/** Server-side asl-belgisi key state + rotation outcome (see marking/circulation-check.ts). */
export interface MarkingApiKeyResult {
  ok: boolean;
  status?: {
    configured: boolean;
    source: "store" | "env" | "none";
    maskedKey?: string;
    updatedAt?: string;
    expiresAt?: string;
  };
  error?: string;
}

// Type declarations for the exposed API
declare global {
  interface Window {
    electronAPI: {
      auth: {
        login: (phone: string, password: string) => Promise<unknown>;
        loginWithPin: (pin: string) => Promise<unknown>;
        logout: () => Promise<void>;
        getProfile: () => Promise<unknown>;
        restoreSession: (token: string) => Promise<unknown>;
        changePassword: (
          currentPassword: string,
          newPassword: string,
        ) => Promise<boolean>;
        isPinConfigured: () => Promise<boolean>;
        setupPin: (pin: string) => Promise<boolean>;
      };
      products: {
        getAll: (filters?: unknown) => Promise<unknown[]>;
        getById: (id: string, opts?: { byDbId?: boolean }) => Promise<unknown>;
        getByBarcode: (barcode: string) => Promise<unknown>;
        findByInternalCode: (internalCode: string) => Promise<unknown>;
        getNextInternalCode: () => Promise<string>;
        create: (data: unknown) => Promise<unknown>;
        update: (id: string, data: unknown) => Promise<unknown>;
        delete: (id: string) => Promise<boolean>;
        search: (query: string) => Promise<unknown[]>;
        getTopSelling: (limit?: number) => Promise<unknown[]>;
        getAnalytics: (
          productId: number,
          startDate?: string,
          endDate?: string,
        ) => Promise<unknown>;
      };
      sales: {
        create: (data: unknown) => Promise<unknown>;
        update: (id: string, data: unknown) => Promise<unknown>;
        delete: (id: string) => Promise<boolean>;
        getAll: (filters?: {
          startDate?: string;
          endDate?: string;
          terminalId?: string;
        }) => Promise<unknown[]>;
        getById: (id: string) => Promise<unknown>;
        getTodaySummary: () => Promise<unknown>;
      };
      users: {
        getAll: () => Promise<unknown[]>;
        create: (data: unknown) => Promise<unknown>;
        update: (id: string, data: unknown) => Promise<unknown>;
        delete: (id: string) => Promise<boolean>;
      };
      categories: {
        getAll: () => Promise<unknown[]>;
        getTopSelling: (
          limit?: number,
        ) => Promise<{ id: number; nameRu: string; nameUz: string }[]>;
        create: (data: unknown) => Promise<unknown>;
        update: (id: string, data: unknown) => Promise<unknown>;
        delete: (id: string) => Promise<boolean>;
      };
      mxik: {
        getGroups: () => Promise<{ groupCode: string; groupName: string }[]>;
        getPackages: (mxikCode: string) => Promise<{ code: string; name: string }[]>;
        lookupByBarcode: (
          barcode: string,
        ) => Promise<{ code: string; name: string; nameRu: string } | null>;
        catalogSearch: (
          q: string,
          page?: number,
          size?: number,
        ) => Promise<{
          results: {
            mxikCode: string;
            mxikName: string;
            groupCode: string;
            groupName: string;
            classCode: string;
            className: string;
            internationalCode: string | null;
            unitName: string | null;
          }[];
          total: number;
        }>;
      };
      fiscal: {
        getConfig: () => Promise<import("../shared/types/fiscal.types").RegosVcrConfig>;
        setConfig: (
          input: import("../shared/types/fiscal.types").RegosVcrConfigInput,
        ) => Promise<import("../shared/types/fiscal.types").RegosVcrConfig>;
        testConnection: () => Promise<import("../shared/types/fiscal.types").FiscalConnectionResult>;
        getStatus: () => Promise<import("../shared/types/fiscal.types").FiscalQueueStatus>;
        fiscalizeOld: () => Promise<import("../shared/types/fiscal.types").FiscalBulkResult>;
        onBulkProgress: (
          cb: (p: import("../shared/types/fiscal.types").FiscalBulkProgress) => void,
        ) => () => void;
        retrySale: (saleId: string) => Promise<{ ok: boolean; error?: string }>;
        previewPayload: (
          saleId: string,
        ) => Promise<import("../shared/types/fiscal.types").FiscalSalePreview | null>;
        refund: (saleId: string) => Promise<{ ok: boolean; fiscalSign?: string; error?: string }>;
        printDuplicate: (saleId: string) => Promise<{ ok: boolean; error?: string }>;
        zInfo: () => Promise<import("../shared/types/fiscal.types").FiscalZReportStatus>;
        zOpen: () => Promise<import("../shared/types/fiscal.types").FiscalActionResult>;
        zClose: () => Promise<import("../shared/types/fiscal.types").FiscalActionResult>;
      };
      inventory: {
        createArrival: (data: unknown) => Promise<unknown>;
        getArrivals: (filters?: unknown) => Promise<unknown[]>;
        getLowStock: () => Promise<unknown[]>;
      };
      suppliers: {
        getAll: (includeInactive?: boolean) => Promise<unknown[]>;
        getById: (id: string) => Promise<unknown>;
        create: (data: unknown) => Promise<unknown>;
        update: (id: string, data: unknown) => Promise<unknown>;
        delete: (id: string) => Promise<boolean>;
        getTransactions: (filters?: unknown) => Promise<unknown[]>;
        createTransaction: (data: unknown) => Promise<unknown>;
        updateTransaction: (id: string, data: unknown) => Promise<unknown>;
        deleteTransaction: (id: string) => Promise<boolean>;
        getBalance: (supplierId: string) => Promise<unknown>;
        recordPayment: (data: unknown) => Promise<unknown>;
      };
      sync: {
        trigger: () => Promise<void>;
        getStatus: () => Promise<unknown>;
        onCompleted: (callback: () => void) => () => void;
        onFailed: (
          callback: (error: { message: string }) => void,
        ) => () => void;
        onStockConflict: (
          callback: (
            conflicts: { id: number; nameRu: string; stock: number }[],
          ) => void,
        ) => () => void;
      };
      printer: {
        printReceipt: (saleId: string) => Promise<boolean>;
        testPrint: () => Promise<boolean>;
        getAvailablePrinters: () => Promise<string[]>;
        printPriceTags: (
          html: string,
          widthMm: number,
          heightMm: number,
        ) => Promise<boolean>;
        printWeightedLabel: (data: unknown) => Promise<boolean>;
        printPriceTagsTSPL: (req: unknown) => Promise<boolean>;
        openCashDrawer: () => Promise<void>;
        testOpenCashDrawer: () => Promise<boolean>;
      };
      weighedItems: {
        create: (data: unknown) => Promise<unknown>;
        findByBarcode: (barcode: string) => Promise<unknown>;
        markAsSold: (id: string, saleId?: string) => Promise<unknown>;
        getAvailable: (productId: number) => Promise<unknown[]>;
        getAll: (filters?: unknown) => Promise<unknown>;
        delete: (id: string) => Promise<boolean>;
      };
      settings: {
        get: (key: string) => Promise<string | null>;
        set: (key: string, value: string) => Promise<void>;
        getAll: () => Promise<Record<string, string>>;
      };
      receipt: {
        scan: (imageBase64: string, mimeType: string) => Promise<unknown>;
        matchProducts: (
          items: { name: string; mxik?: string | null }[],
        ) => Promise<unknown[]>;
        getPlan: () => Promise<{ plan: string; balance_uzs: number | null }>;
        getScanUsage: () => Promise<{ balance_uzs: number | null }>;
      };
      analytics: {
        getData: (filters: {
          startDate: string;
          endDate: string;
          terminalId?: string;
        }) => Promise<unknown>;
      };
      terminals: {
        getKnown: () => Promise<string[]>;
        getStatus: () => Promise<
          { terminalId: string; lastSyncAt: string; unsyncedCount: number }[]
        >;
      };
      app: {
        getVersion: () => Promise<string>;
        isOnline: () => Promise<boolean>;
        getTerminalId: () => Promise<string>;
        getStoreInfo: () => Promise<{ storeId: string; storeName: string }>;
        quit: () => Promise<void>;
        relaunch: () => Promise<void>;
        onCloseRequested: (callback: () => void) => () => void;
        confirmClose: () => void;
      };
      config: {
        getLocalConfig: () => Promise<{
          storeId: string;
          apiUrl: string;
          storeName: string;
          terminalId: string;
        } | null>;
        updateLocalConfig: (data: {
          storeId?: string;
          apiUrl?: string;
          storeName?: string;
          terminalId?: string;
        }) => Promise<{ requiresRestart?: boolean }>;
      };
      smena: {
        getCurrent: () => Promise<unknown | null>;
        open: (data: { initialCash: number }) => Promise<unknown>;
        addMovement: (data: {
          smenaId: string;
          type: "PAY_IN" | "PAY_OUT";
          amount: number;
          note?: string;
        }) => Promise<unknown>;
        close: (data: {
          smenaId: string;
          finalCash: number;
        }) => Promise<unknown>;
        printZReport: (smenaId: string) => Promise<boolean>;
        printXReport: (smenaId: string) => Promise<boolean>;
        getHistory: (filters?: { limit?: number }) => Promise<unknown[]>;
      };
      setup: {
        authenticate: (data: {
          phone: string;
          password: string;
          storeId: string;
        }) => Promise<{
          success: boolean;
          token: string;
          user: { phone: string; nameRu: string; nameUz: string; role: string };
        }>;
        complete: (data: {
          storeId: string;
          terminalId: string;
          storeName: string;
          storeAddress: string;
          storePhone: string;
          storeStir: string;
          taxRate: string;
          syncInterval: string;
          token: string;
          pin?: string;
        }) => Promise<{ success: boolean }>;
        launchApp: () => Promise<void>;
      };
      updater: {
        checkForUpdates: () => Promise<void>;
        startDownload: () => Promise<void>;
        cancelDownload: () => Promise<void>;
        quitAndInstall: () => void;
        onChecking: (cb: () => void) => () => void;
        onAvailable: (
          cb: (info: { version: string; releaseDate: string }) => void,
        ) => () => void;
        onNotAvailable: (cb: () => void) => () => void;
        onProgress: (
          cb: (p: {
            percent: number;
            transferred: number;
            total: number;
            bytesPerSecond: number;
          }) => void,
        ) => () => void;
        onDownloaded: (cb: (info: { version: string }) => void) => () => void;
        onError: (cb: (e: { message: string }) => void) => () => void;
        onCancelled: (cb: () => void) => () => void;
      };
      markingCodes: {
        check: (code: string) => Promise<{
          alreadySold: boolean;
          soldAt?: string;
          terminalId?: string;
          source?: 'local' | 'server';
        }>;
        record: (entries: { code: string; productBarcode?: string }[]) => Promise<void>;
        removeForSale: (saleId: string) => Promise<void>;
      };
      markingCheck: {
        verify: (code: string) => Promise<{
          reachable: boolean;
          lookupCode?: string;
          error?: string;
          verdict: 'IN' | 'OUT' | 'UNKNOWN';
          gtin?: string;
          details?: {
            isValid: boolean;
            status?: string;
            extendedStatus?: string;
            gtin?: string;
            productId?: string;
            productionDate?: string;
            expirationDate?: string;
            productSeries?: string;
            packageType?: string;
            issuerName?: string;
          };
          product?: {
            id: string;
            nameUz: string;
            nameRu: string;
            barcode: string | null;
            mxik: string | null;
          };
          alreadySold?: { soldAt?: string; terminalId?: string };
        }>;
        apiKeyStatus: () => Promise<MarkingApiKeyResult>;
        setApiKey: (key: string) => Promise<MarkingApiKeyResult>;
      };
      logger: {
        error: (msg: string) => void;
        warn: (msg: string) => void;
        info: (msg: string) => void;
      };
    };
  }
}
