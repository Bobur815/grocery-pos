// IPC Client wrapper for Electron communication
// Provides typed wrappers around window.electronAPI

// Re-export the electronAPI for easy access
export const ipc = typeof window !== 'undefined' ? window.electronAPI : null;

// Type-safe helper functions
export const auth = {
  login: (phone: string, password: string) =>
    ipc?.auth.login(phone, password),
  logout: () => ipc?.auth.logout(),
  getProfile: () => ipc?.auth.getProfile(),
  changePassword: (currentPassword: string, newPassword: string) =>
    ipc?.auth.changePassword(currentPassword, newPassword),
};

export const products = {
  getAll: (filters?: { categoryId?: string; active?: boolean }) =>
    ipc?.products.getAll(filters),
  getById: (id: string) => ipc?.products.getById(id),
  getByBarcode: (barcode: string) => ipc?.products.getByBarcode(barcode),
  findByInternalCode: (internalCode: string) =>
    ipc?.products.findByInternalCode(internalCode),
  getNextInternalCode: () => ipc?.products.getNextInternalCode(),
  create: (data: unknown) => ipc?.products.create(data),
  update: (id: string, data: unknown) => ipc?.products.update(id, data),
  delete: (id: string) => ipc?.products.delete(id),
  search: (query: string) => ipc?.products.search(query),
  getAnalytics: (productId: number, startDate?: string, endDate?: string) =>
    ipc?.products.getAnalytics(productId, startDate, endDate),
};

export const sales = {
  create: (data: unknown) => ipc?.sales.create(data),
  update: (id: string, data: unknown) => ipc?.sales.update(id, data),
  delete: (id: string) => ipc?.sales.delete(id),
  getAll: (filters?: { startDate?: string; endDate?: string }) =>
    ipc?.sales.getAll(filters),
  getById: (id: string) => ipc?.sales.getById(id),
  getTodaySummary: () => ipc?.sales.getTodaySummary(),
};

export const users = {
  getAll: () => ipc?.users.getAll(),
  create: (data: unknown) => ipc?.users.create(data),
  update: (id: string, data: unknown) => ipc?.users.update(id, data),
  delete: (id: string) => ipc?.users.delete(id),
};

export const categories = {
  getAll: () => ipc?.categories.getAll(),
  create: (data: unknown) => ipc?.categories.create(data),
  update: (id: string, data: unknown) => ipc?.categories.update(id, data),
  delete: (id: string) => ipc?.categories.delete(id),
};

export const inventory = {
  createArrival: (data: unknown) => ipc?.inventory.createArrival(data),
  getArrivals: (filters?: { productId?: string }) =>
    ipc?.inventory.getArrivals(filters),
  getLowStock: () => ipc?.inventory.getLowStock(),
};

export const suppliers = {
  getAll: (includeInactive?: boolean) => ipc?.suppliers.getAll(includeInactive),
  getById: (id: string) => ipc?.suppliers.getById(id),
  create: (data: unknown) => ipc?.suppliers.create(data),
  update: (id: string, data: unknown) => ipc?.suppliers.update(id, data),
  delete: (id: string) => ipc?.suppliers.delete(id),
  getTransactions: (filters?: unknown) => ipc?.suppliers.getTransactions(filters),
  createTransaction: (data: unknown) => ipc?.suppliers.createTransaction(data),
  updateTransaction: (id: string, data: unknown) =>
    ipc?.suppliers.updateTransaction(id, data),
  deleteTransaction: (id: string) => ipc?.suppliers.deleteTransaction(id),
  getBalance: (supplierId: string) => ipc?.suppliers.getBalance(supplierId),
  recordPayment: (data: unknown) => ipc?.suppliers.recordPayment(data),
};

export const sync = {
  trigger: () => ipc?.sync.trigger(),
  getStatus: () => ipc?.sync.getStatus(),
  onCompleted: (callback: () => void) => ipc?.sync.onCompleted(callback),
  onFailed: (callback: (error: { message: string }) => void) =>
    ipc?.sync.onFailed(callback),
};

export const printer = {
  printReceipt: (saleId: string) => ipc?.printer.printReceipt(saleId),
  testPrint: () => ipc?.printer.testPrint(),
  getAvailablePrinters: () => ipc?.printer.getAvailablePrinters(),
  printWeightedLabel: (data: unknown) => ipc?.printer.printWeightedLabel(data),
  openCashDrawer: () => ipc?.printer.openCashDrawer(),
};

export const weighedItems = {
  create: (data: unknown) => ipc?.weighedItems.create(data),
  findByBarcode: (barcode: string) => ipc?.weighedItems.findByBarcode(barcode),
  markAsSold: (id: string, saleId?: string) =>
    ipc?.weighedItems.markAsSold(id, saleId),
  getAvailable: (productId: number) => ipc?.weighedItems.getAvailable(productId),
  getAll: (filters?: unknown) => ipc?.weighedItems.getAll(filters),
  delete: (id: string) => ipc?.weighedItems.delete(id),
};

export const settings = {
  get: (key: string) => ipc?.settings.get(key),
  set: (key: string, value: string) => ipc?.settings.set(key, value),
  getAll: () => ipc?.settings.getAll(),
};

export const receipt = {
  scan: (imageBase64: string, mimeType: string) =>
    ipc?.receipt.scan(imageBase64, mimeType),
  matchProducts: (items: { name: string; mxik?: string | null }[]) =>
    ipc?.receipt.matchProducts(items),
  getScanUsage: () =>
    ipc?.receipt.getScanUsage(),
};

export const analytics = {
  getData: (filters: { startDate: string; endDate: string }) =>
    ipc?.analytics.getData(filters),
};

export const markingCheck = {
  verify: (code: string) => ipc?.markingCheck.verify(code),
  apiKeyStatus: () => ipc?.markingCheck.apiKeyStatus(),
  setApiKey: (key: string) => ipc?.markingCheck.setApiKey(key),
};

export const app = {
  getVersion: () => ipc?.app.getVersion(),
  getTerminalId: () => ipc?.app.getTerminalId(),
  quit: () => ipc?.app.quit(),
};
