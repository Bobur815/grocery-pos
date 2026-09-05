
# Grocery Store POS System - Complete Documentation

## Table of Contents

1. [Project Overview](#project-overview)
2. [System Architecture](#system-architecture)
3. [Technology Stack](#technology-stack)
4. [User Roles & Permissions](#user-roles--permissions)
5. [Project Structure](#project-structure)
6. [Database Schema](#database-schema)
7. [Features by Role](#features-by-role)
8. [API Endpoints](#api-endpoints)
9. [Development Setup](#development-setup)
10. [Building & Deployment](#building--deployment)
11. [Configuration](#configuration)
12. [Security](#security)
13. [Sync Mechanism](#sync-mechanism)
14. [Internationalization (i18n)](#internationalization-i18n)
15. [Theming (Dark/Light Mode)](#theming-darklight-mode)
16. [Future Enhancements](#future-enhancements)
17. [Troubleshooting](#troubleshooting)

---

## Project Overview

### Description
A modern, offline-first Point of Sale (POS) system designed for grocery stores with **multi-tenant architecture**. The system consists of:
- **Desktop POS terminals** (Windows monoblocks) with local SQLite databases
- **Central VPS backend** (Contabo) with PostgreSQL for data aggregation
- **Multi-store support** - Each store operates independently with isolated data
- **Automatic synchronization** every 5 minutes
- **Telegram bot integration** for remote inventory management
- **Multi-language support** (Russian & Uzbek)
- **Dark/Light theme** support

### Key Features
- Offline-first operation (works without internet)
- **Multi-tenant architecture** (multiple stores on single server)
- Barcode scanning support
- Receipt printing
- Real-time inventory tracking
- Sales analytics & reports
- Multi-terminal support per store
- Role-based access control (Super Admin/Admin/User)
- Automatic data synchronization
- Remote management via Telegram

### Target Hardware
- **POS Terminals:** Windows 10/11 monoblocks (i5 6th gen, 8GB RAM)
- **Backend Server:** Contabo VPS (7.6GB RAM, Ubuntu 24)
- **Peripherals:** USB barcode scanners, thermal printers

---

## System Architecture

### High-Level Architecture

```
+---------------------------------------------------------------------+
|                        CONTABO VPS SERVER                            |
|                    (Always Online - Central Hub)                     |
|                                                                      |
|  +----------------------------------------------------------------+ |
|  |              PostgreSQL Database (Master)                       | |
|  |  * Multi-tenant: Each store has isolated data                   | |
|  |  * Stores table as central entity                               | |
|  |  * All historical sales data per store                          | |
|  |  * Products catalog with real-time stock per store              | |
|  |  * User accounts & authentication per store                     | |
|  |  * Inventory movements & analytics                              | |
|  |  * Audit logs per store                                         | |
|  +----------------------------------------------------------------+ |
|                                |                                     |
|  +----------------------------------------------------------------+ |
|  |                 NestJS REST API Backend                         | |
|  |  * POST /api/sales/sync      - Receive POS sales (per store)    | |
|  |  * GET  /api/products        - Send product updates (per store) | |
|  |  * POST /api/inventory       - Telegram inventory adds          | |
|  |  * GET  /api/analytics       - Admin dashboard data             | |
|  |  * GET  /api/stores          - Super Admin store management     | |
|  |  * Port: 3000                                                   | |
|  +----------------------------------------------------------------+ |
|                                                                      |
|  Exposed: https://your-domain.com/api                               |
|  SSL: Let's Encrypt (auto-renewed)                                  |
+---------------------------------------------------------------------+
                                 |
                          Internet / WiFi
                                 |
+---------------------------------------------------------------------+
|                    STORE A (Local Network)                           |
|                    192.168.1.x (WiFi/Ethernet)                       |
|                                                                      |
|  +----------------------------+     +----------------------------+  |
|  |   Monoblock POS #1         |     |   Monoblock POS #2         |  |
|  |   (TERMINAL_01)            |     |   (TERMINAL_02)            |  |
|  |   Windows 10/11            |     |   Windows 10/11            |  |
|  |                            |     |                            |  |
|  |  +----------------------+  |     |  +----------------------+  |  |
|  |  |  Electron App        |  |     |  |  Electron App        |  |  |
|  |  |  LocalConfig:        |  |     |  |  LocalConfig:        |  |  |
|  |  |   storeId: "abc123"  |  |     |  |   storeId: "abc123"  |  |  |
|  |  |   terminalId: "T01"  |  |     |  |   terminalId: "T02"  |  |  |
|  |  |                      |  |     |  |                      |  |  |
|  |  |  SQLite Cache        |  |     |  |  SQLite Cache        |  |  |
|  |  |  (pos-local.db)      |  |     |  |  (pos-local.db)      |  |  |
|  |  |  * Products          |  |     |  |  * Products          |  |  |
|  |  |  * Sales queue       |  |     |  |  * Sales queue       |  |  |
|  |  |  * SyncQueue         |  |     |  |  * SyncQueue         |  |  |
|  |  +----------------------+  |     |  +----------------------+  |  |
|  +----------------------------+     +----------------------------+  |
|            |                                   |                     |
|            +-------------------+---------------+                     |
|                                |                                     |
|                   Syncs every 5 minutes to VPS                       |
|              (Works offline, queues when no internet)                |
+---------------------------------------------------------------------+

+---------------------------------------------------------------------+
|                    STORE B (Different Location)                      |
|                    Different network, same VPS                       |
|                                                                      |
|  +----------------------------+                                      |
|  |   Monoblock POS #1         |                                      |
|  |   LocalConfig:             |                                      |
|  |     storeId: "xyz789"      |  <-- Different store ID              |
|  |     terminalId: "T01"      |                                      |
|  +----------------------------+                                      |
+---------------------------------------------------------------------+
```

### Data Flow

#### Sale Transaction Flow
```
1. Cashier scans barcode -> 2. Add to cart -> 3. Customer pays ->
4. Print receipt -> 5. Save to local SQLite (synced=false) ->
6. Add to SyncQueue -> 7. Every 5 min: Sync service sends to VPS with storeId ->
8. VPS saves to PostgreSQL (store-scoped) -> 9. VPS confirms ->
10. Local SQLite marks as synced, removes from SyncQueue
```

#### Product Update Flow
```
1. Admin updates price on VPS (or via Telegram) ->
2. VPS updates PostgreSQL (store-specific) ->
3. POS terminals pull updates every 5 min (filtered by storeId) ->
4. Local SQLite updated ->
5. UI shows new prices immediately
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|---------------|----------|
| **PostgreSQL** | Master database, multi-tenant data store | VPS |
| **NestJS API** | Business logic, authentication, store isolation | VPS |
| **Nginx** | Reverse proxy, SSL termination | VPS |
| **Electron Main Process** | Local database, sync service, IPC | POS Terminal |
| **React Renderer** | User interface, POS operations | POS Terminal |
| **SQLite** | Local cache, offline operation, sync queue | POS Terminal |
| **Sync Service** | Background worker, data synchronization | POS Terminal |
| **Telegram Bot** | Remote inventory management (per store) | VPS |

---

## Technology Stack

### Backend (VPS)
- **Runtime:** Node.js 20+
- **Framework:** NestJS 10+
- **Database:** PostgreSQL 15 (multi-tenant)
- **ORM:** Prisma 5+
- **Authentication:** JWT (jsonwebtoken)
- **API Style:** REST
- **Containerization:** Docker + Docker Compose
- **Web Server:** Nginx (reverse proxy)
- **SSL:** Let's Encrypt (Certbot)

### Frontend/Desktop (POS Terminals)
- **Framework:** Electron 40+
- **UI Library:** React 18+
- **Language:** TypeScript 5+
- **State Management:** Zustand
- **Styling:** Styled Components
- **Icons:** Lucide React
- **Local Database:** SQLite (via Prisma)
- **i18n:** react-i18next
- **Build Tool:** electron-vite + Electron Builder

### Shared
- **ORM:** Prisma Client (works with both PostgreSQL and SQLite)
- **Validation:** Zod
- **Date Handling:** date-fns
- **HTTP Client:** Fetch API
- **Receipt Generation:** HTML-based receipt builder (shared module)

### Development Tools
- **Monorepo:** Single repository with conditional builds
- **Version Control:** Git
- **Package Manager:** npm or pnpm
- **Linting:** ESLint
- **Formatting:** Prettier
- **Testing:** Jest, React Testing Library

---

## User Roles & Permissions

### Role Hierarchy

```
+--------------------------------------------------------------+
|                      SUPER_ADMIN                              |
|  Full system access - Platform Owner/Operator                 |
|  * All Admin permissions across ALL stores                    |
|  * Create and manage stores                                   |
|  * Assign store admins                                        |
|  * View cross-store analytics                                 |
|  * System-wide settings                                       |
|  * Not bound to any specific store (storeId = null)           |
+--------------------------------------------------------------+
                         |
+--------------------------------------------------------------+
|                      ADMIN (Store Admin)                      |
|  Full store access - Store Owner/Manager                      |
|  * All User permissions +                                     |
|  * Manage products (add, edit, delete) for their store        |
|  * Manage users (create cashiers) for their store             |
|  * View all analytics & reports for their store               |
|  * Access admin dashboard                                     |
|  * Manage inventory arrivals                                  |
|  * Edit store settings                                        |
|  * View audit logs for their store                            |
|  * Export data                                                |
|  * Bound to specific storeId                                  |
+--------------------------------------------------------------+
                         |
+--------------------------------------------------------------+
|                      USER (Cashier)                           |
|  Limited access - Daily operations only                       |
|  * Process sales (scan, cart, checkout)                       |
|  * Print receipts                                             |
|  * Search products                                            |
|  * View product prices & stock                                |
|  * View own shift sales (today only)                          |
|  * Basic reports (today's sales summary)                      |
|  * Cannot modify inventory                                    |
|  * Cannot see other cashiers' data                            |
|  * Cannot access settings                                     |
|  * Bound to specific storeId                                  |
+--------------------------------------------------------------+
```

### Detailed Permissions Matrix

| Feature | Super Admin | Admin | User (Cashier) |
|---------|-------------|-------|----------------|
| **Store Management** |
| Create stores | Yes | No | No |
| Edit store settings | All stores | Own store | No |
| Delete stores | Yes | No | No |
| View all stores | Yes | No | No |
| **Sales Operations** |
| Process sales | Yes | Yes | Yes |
| Apply discounts | Yes | Yes | No |
| Void transactions | Yes | Yes | No |
| View all sales | All stores | Own store | Own only |
| **Product Management** |
| View products | All stores | Own store | Own store (read-only) |
| Add products | Yes | Own store | No |
| Edit products | Yes | Own store | No |
| Delete products | Yes | Own store | No |
| Adjust stock | Yes | Own store | No |
| **Inventory** |
| Record arrivals | Yes | Own store | No |
| View stock history | All stores | Own store | Current only |
| Manage suppliers | Yes | Own store | No |
| **Reports & Analytics** |
| Daily summary | All stores | Own store | Own shifts |
| Monthly reports | All stores | Own store | No |
| Cross-store analytics | Yes | No | No |
| Product performance | All stores | Own store | No |
| Profit/Loss | All stores | Own store | No |
| Export reports | Yes | Own store | No |
| **User Management** |
| Create users | All stores | Own store | No |
| Edit users | All stores | Own store | Own profile |
| Delete users | All stores | Own store | No |
| View user activity | All stores | Own store | No |
| **Settings** |
| System settings | Yes | No | No |
| Store settings | All stores | Own store | No |
| Language/Theme | Yes | Yes | Yes |
| Terminal config | All stores | Own store | No |
| Printer setup | All stores | Own store | No |

### Role Implementation

```typescript
// Prisma Schema - PostgreSQL (VPS)
enum UserRole {
  SUPER_ADMIN  // Can manage all stores
  ADMIN        // Store admin
  USER         // Cashier
}

model User {
  id        String   @id @default(cuid())
  storeId   String?  @map("store_id") // Null for SUPER_ADMIN
  store     Store?   @relation(fields: [storeId], references: [id])
  phone     String
  password  String   // Bcrypt hashed
  role      UserRole @default(USER)
  nameUz    String   @map("name_uz")
  nameRu    String   @map("name_ru")
  active    Boolean  @default(true)

  @@unique([storeId, phone]) // Same phone can exist in different stores
  @@index([storeId])
  @@map("users")
}
```

### Authentication Flow

```
Login Methods:
  A) PIN Login (Primary - PinLoginPage):
     1. PIN keypad displayed with virtual keyboard
     2. User enters 4-digit store PIN
     3. PIN verified against bcrypt hash in LocalConfig.storePin
     4. On success, user selects their profile from local user list
     5. Session restored locally (offline-capable)

  B) Phone + Password Login:
     1. Login Screen -> Phone + Password
     2. Local validation against cached users in SQLite
     3. Auth token stored in Zustand auth-store
     4. Session can be restored on app restart (auth:restoreSession)

  Common:
  - UI conditionally renders based on role (ProtectedRoute + RoleGuard)
  - Local auth works fully offline
  - Sync service uses separate auth token for VPS communication
```

---

## Project Structure

### Repository Layout (Monorepo)

```
grocery-pos/
+-- README.md
+-- GROCERY_POS_DOCUMENTATION.md
+-- package.json
+-- tsconfig.json
+-- tsconfig.server.json
+-- electron.vite.config.ts          # electron-vite config (main, preload, renderer)
+-- electron-builder.config.js       # Electron build config
+-- nest-cli.json
+-- .env.example
+-- .gitignore
+-- docker-compose.yml               # VPS deployment
+-- Dockerfile                       # NestJS container
+-- nginx.conf                       # Nginx configuration
|
+-- prisma/                          # Database schemas
|   +-- schema.prisma                # PostgreSQL schema (VPS) - Multi-tenant
|   +-- schema.sqlite.prisma         # SQLite schema (POS Terminal)
|   +-- migrations/                  # PostgreSQL migrations
|   +-- seed.ts                      # Initial data
|
+-- src/
|   +-- main/                        # Electron Main Process (POS)
|   |   +-- index.ts                 # Entry point: init DB, seed, create window, IPC, SyncService
|   |   +-- window.ts                # Window management
|   |   +-- preload.ts               # Context bridge (electronAPI)
|   |   |
|   |   +-- database/
|   |   |   +-- sqlite-client.ts     # getPrismaClient(), initializeDatabase(), runMigrations()
|   |   |   +-- migrations.ts        # Migration helpers
|   |   |   +-- seed.ts              # seedLocalDatabase()
|   |   |
|   |   +-- sync/
|   |   |   +-- sync-service.ts      # Main sync logic (start, stop, sync, triggerSync)
|   |   |   +-- sales-sync.ts        # Upload sales
|   |   |   +-- products-sync.ts     # Download products
|   |   |   +-- queue-manager.ts     # Auth token management for sync
|   |   |
|   |   +-- ipc/
|   |   |   +-- handlers.ts          # Main IPC orchestrator + inline handlers for:
|   |   |   |                        #   categories, inventory, suppliers (full CRUD + transactions),
|   |   |   |                        #   settings, app
|   |   |   +-- auth-handlers.ts     # Auth + users IPC handlers
|   |   |   +-- products-handlers.ts # Products CRUD + analytics + search
|   |   |   +-- sales-handlers.ts    # Sales CRUD + receipt number generation
|   |   |
|   |   +-- printer/
|   |   |   +-- thermal-printer.ts   # Receipt printing, test print, price tag printing
|   |   |                            # Uses BrowserWindow.webContents.print() + shared receipt-html
|   |   |
|   |   +-- config/
|   |       +-- app-config.ts        # App configuration
|   |
|   +-- renderer/                    # React Frontend (POS)
|   |   +-- index.html
|   |   +-- main.tsx                 # React entry
|   |   +-- App.tsx                  # Root component + routing
|   |   |
|   |   +-- pages/
|   |   |   +-- Login/
|   |   |   |   +-- PinLoginPage.tsx         # PIN keypad login
|   |   |   +-- POS/
|   |   |   |   +-- POSScreen.tsx            # Main POS interface
|   |   |   |   +-- Cart.tsx
|   |   |   |   +-- ProductSearch.tsx
|   |   |   |   +-- Checkout.tsx
|   |   |   |   +-- PosTabBar.tsx            # Multi-tab POS
|   |   |   |   +-- SalesHistoryModal.tsx    # Today's sales with edit/delete
|   |   |   +-- Products/
|   |   |   |   +-- ProductList.tsx
|   |   |   |   +-- ProductForm.tsx          # Admin only
|   |   |   |   +-- ProductDetails.tsx       # Product detail + analytics
|   |   |   |   +-- StockManagement.tsx      # Admin only
|   |   |   |   +-- CategoryManagementModal.tsx  # CRUD categories
|   |   |   |   +-- NewArrivalModal.tsx      # New arrival with deferred price logic
|   |   |   +-- Reports/
|   |   |   |   +-- DailySummary.tsx
|   |   |   |   +-- MonthlyReport.tsx        # Admin only
|   |   |   |   +-- Analytics.tsx            # Admin only
|   |   |   +-- Settings/
|   |   |   |   +-- SettingsPage.tsx         # Settings hub (Admin)
|   |   |   |   +-- UserSettings.tsx         # Language, theme, password
|   |   |   |   +-- SystemSettings.tsx       # Store info, tax, sync (Admin)
|   |   |   |   +-- PrinterSettings.tsx      # Printer selection + test (Admin)
|   |   |   |   +-- PriceTags.tsx            # Price tag template builder (Admin)
|   |   |   |   +-- PrintTagsModal.tsx       # Product selector for printing tags
|   |   |   |   +-- ReceiptSettings.tsx      # Receipt format + live preview (Admin)
|   |   |   +-- Users/
|   |   |   |   +-- UserList.tsx             # Admin only
|   |   |   |   +-- UserForm.tsx             # Admin only
|   |   |   +-- Suppliers/
|   |   |       +-- SupplierList.tsx          # Supplier list with balance filter
|   |   |       +-- SupplierForm.tsx          # Create/Edit supplier
|   |   |       +-- SupplierDetails.tsx       # Detail + transaction history
|   |   |       +-- SupplierManagementModal.tsx
|   |   |       +-- SupplierTransactionForm.tsx
|   |   |       +-- index.ts
|   |   |
|   |   +-- components/
|   |   |   +-- common/
|   |   |   |   +-- Button.tsx
|   |   |   |   +-- ConfirmDialog.tsx
|   |   |   |   +-- DateInput.tsx
|   |   |   |   +-- EmptyPlaceholder.tsx
|   |   |   |   +-- Input.tsx
|   |   |   |   +-- Modal.tsx
|   |   |   |   +-- SearchControls.tsx
|   |   |   |   +-- Select.tsx
|   |   |   |   +-- Table.tsx
|   |   |   |   +-- UzbekPhoneInput.tsx
|   |   |   |   +-- VirtualKeyboard.tsx
|   |   |   +-- layout/
|   |   |   |   +-- Layout.tsx
|   |   |   |   +-- Sidebar.tsx
|   |   |   +-- products/
|   |   |   |   +-- ProductFilters.tsx
|   |   |   +-- suppliers/
|   |   |   |   +-- SupplierFilters.tsx
|   |   |   +-- protected/
|   |   |       +-- ProtectedRoute.tsx
|   |   |       +-- RoleGuard.tsx
|   |   |
|   |   +-- hooks/
|   |   |   +-- useAuth.ts
|   |   |   +-- useProducts.ts
|   |   |   +-- useSales.ts
|   |   |   +-- useSuppliers.ts      # Supplier + transaction operations
|   |   |   +-- useSync.ts
|   |   |
|   |   +-- store/
|   |   |   +-- index.ts             # Re-exports: auth, cart, products, settings stores
|   |   |   +-- auth-store.ts
|   |   |   +-- cart-store.ts
|   |   |   +-- products-store.ts
|   |   |   +-- settings-store.ts    # Language + theme with persist
|   |   |   +-- suppliers-store.ts   # Suppliers state
|   |   |
|   |   +-- api/
|   |   |   +-- client.ts            # HTTP client (for server API)
|   |   |   +-- ipc-client.ts        # Electron IPC wrapper
|   |   |   +-- endpoints.ts         # API endpoints
|   |   |
|   |   +-- context/
|   |   |   +-- SidebarContext.tsx
|   |   |   +-- ToastContext.tsx
|   |   |
|   |   +-- i18n/
|   |   |   +-- index.ts             # i18next config
|   |   |   +-- locales/
|   |   |       +-- ru.json          # Russian translations
|   |   |       +-- uz.json          # Uzbek translations
|   |   |
|   |   +-- theme/
|   |   |   +-- ThemeProvider.tsx
|   |   |   +-- themes.ts            # Dark/Light themes
|   |   |   +-- GlobalStyles.tsx
|   |   |   +-- styled.d.ts          # styled-components type augmentation
|   |   |
|   |   +-- utils/
|   |   |   +-- formatters.ts        # Currency, date formatters
|   |   |   +-- validators.ts
|   |   |   +-- helpers.ts
|   |   |
|   |   +-- images/                  # Static images
|   |
|   +-- server/                      # NestJS Backend (VPS) - planned
|   |
|   +-- shared/                      # Shared code (both POS & VPS)
|   |   +-- index.ts                 # Re-exports from constants/ and utils/
|   |   +-- receipt-html.ts          # HTML receipt builder (buildReceiptHTML, buildTestReceiptHTML, buildSampleReceiptHTML)
|   |   |
|   |   +-- types/
|   |   |   +-- index.ts             # Re-exports all types
|   |   |   +-- user.types.ts
|   |   |   +-- product.types.ts     # Product, Category, ProductUnit, FilterParams, etc.
|   |   |   +-- sale.types.ts        # Sale, SaleItem, CartItem, DailySummary, etc.
|   |   |   +-- supplier.types.ts    # Supplier, SupplierTransaction, payment methods, etc.
|   |   |   +-- store.types.ts       # Store, StoreSettings
|   |   |   +-- api.types.ts         # ApiResponse, PaginatedResponse, SyncRequest, etc.
|   |   |
|   |   +-- constants/
|   |   |   +-- index.ts
|   |   |   +-- roles.ts             # USER_ROLES, ROLE_PERMISSIONS, helper functions
|   |   |   +-- payment-methods.ts   # CASH, CARD, MIXED with bilingual labels
|   |   |   +-- sync-intervals.ts
|   |   |
|   |   +-- utils/
|   |       +-- index.ts
|   |       +-- phone.ts             # Phone number utilities
|   |       +-- transformers.ts      # formatCurrency (ru/uz locale)
|   |       +-- transliterator.ts    # Uzbek Latin <-> Cyrillic conversion
|   |       +-- validators.ts        # Comprehensive validators
|   |
|   +-- generated/                   # Prisma generated clients
|       +-- prisma-sqlite/           # SQLite client for POS
|
+-- scripts/
    +-- build-pos.js                 # Build POS .exe
    +-- build-server.js              # Build VPS backend
    +-- deploy-vps.sh                # Deploy to Contabo
    +-- seed-sqlite.ts               # SQLite seed script
```

### Key Files Explained

| File/Folder | Purpose | Used By |
|-------------|---------|---------|
| `src/main/` | Electron main process, runs Node.js | POS Terminal |
| `src/renderer/` | React UI, runs in browser context | POS Terminal |
| `src/server/` | NestJS backend API (planned) | VPS Only |
| `src/shared/` | TypeScript types, utilities, receipt HTML builder | Both |
| `src/shared/receipt-html.ts` | HTML receipt generation (shared between printer & preview) | Both |
| `prisma/schema.prisma` | PostgreSQL schema with multi-tenancy | VPS |
| `prisma/schema.sqlite.prisma` | SQLite schema for offline POS | POS Terminal |
| `src/generated/prisma-sqlite/` | Generated SQLite Prisma client | POS Terminal |
| `electron.vite.config.ts` | Build config for main, preload, and renderer | Build Process |
| `electron-builder.config.js` | Creates Windows .exe installer | Build Process |
| `docker-compose.yml` | Deploys backend to VPS | VPS Only |

### IPC Channels (Preload → Main Process)

| Namespace | Channels |
|-----------|----------|
| `auth` | login, loginWithPin, logout, getProfile, restoreSession |
| `products` | getAll, getById, getByBarcode, create, update, delete, search, getTopSelling, getAnalytics |
| `sales` | create, update, delete, getAll, getById, getTodaySummary |
| `users` | getAll, create, update, delete |
| `categories` | getAll, create, update, delete |
| `inventory` | createArrival, getArrivals, getLowStock |
| `suppliers` | getAll, getById, create, update, delete, getTransactions, createTransaction, updateTransaction, deleteTransaction, getBalance, recordPayment |
| `sync` | trigger, getStatus, onCompleted (listener), onFailed (listener) |
| `printer` | printReceipt, testPrint, getAvailablePrinters, printPriceTags |
| `settings` | get, set, getAll |
| `app` | getVersion, getTerminalId, getStoreInfo, quit |

### Frontend Routes (App.tsx)

| Route | Component | Access |
|-------|-----------|--------|
| `/login` | PinLoginPage | Public |
| `/` | POSScreen | All authenticated |
| `/products` | ProductList | All authenticated |
| `/products/new` | ProductForm | ADMIN |
| `/products/:id` | ProductDetails | All authenticated |
| `/products/:id/edit` | ProductForm | ADMIN |
| `/products/stock` | StockManagement | ADMIN |
| `/reports/daily` | DailySummary | All authenticated |
| `/reports/monthly` | MonthlyReport | ADMIN |
| `/reports/analytics` | Analytics | ADMIN |
| `/settings` | SettingsPage | ADMIN |
| `/settings/user` | UserSettings | All authenticated |
| `/settings/system` | SystemSettings | ADMIN |
| `/settings/printer` | PrinterSettings | ADMIN |
| `/settings/price-tags` | PriceTags | ADMIN |
| `/settings/receipt` | ReceiptSettings | ADMIN |
| `/users` | UserList | ADMIN |
| `/users/new` | UserForm | ADMIN |
| `/users/:id/edit` | UserForm | ADMIN |
| `/suppliers` | SupplierList | ADMIN |
| `/suppliers/new` | SupplierForm | ADMIN |
| `/suppliers/:id` | SupplierDetails | ADMIN |
| `/suppliers/:id/edit` | SupplierForm | ADMIN |

---

## Database Schema

### PostgreSQL Schema (VPS - Multi-Tenant)

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ==================== MULTI-TENANCY ====================

model Store {
  id        String   @id @default(cuid())
  name      String
  address   String?  @db.Text
  phone     String?
  active    Boolean  @default(true)
  settings  String?  @db.Text // JSON: tax rate, receipt template, etc.

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // Relations - All data scoped to store
  users             User[]
  categories        Category[]
  products          Product[]
  sales             Sale[]
  inventoryArrivals InventoryArrival[]
  suppliers         Supplier[]
  systemSettings    SystemSetting[]
  auditLogs         AuditLog[]

  @@map("stores")
}

// ==================== USER MANAGEMENT ====================

enum UserRole {
  SUPER_ADMIN // Can manage all stores
  ADMIN       // Store admin
  USER        // Cashier
}

model User {
  id        String   @id @default(cuid())
  storeId   String?  @map("store_id") // Null for SUPER_ADMIN
  store     Store?   @relation(fields: [storeId], references: [id])
  phone     String
  password  String   // Bcrypt hashed
  role      UserRole @default(USER)
  nameUz    String   @map("name_uz")
  nameRu    String   @map("name_ru")
  active    Boolean  @default(true)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([storeId, phone]) // Same phone can exist in different stores
  @@index([storeId])
  @@map("users")
}

// ==================== PRODUCTS & INVENTORY ====================

model Category {
  id        Int        @id @default(autoincrement())
  storeId   String     @map("store_id")
  store     Store      @relation(fields: [storeId], references: [id])
  nameUz    String     @map("name_uz")
  nameRu    String     @map("name_ru")
  active    Boolean    @default(true)
  products  Product[]
  suppliers Supplier[]
  createdAt DateTime   @default(now()) @map("created_at")

  @@index([storeId])
  @@map("categories")
}

model Product {
  id         Int      @id @default(autoincrement())
  storeId    String   @map("store_id")
  store      Store    @relation(fields: [storeId], references: [id])
  barcode    String
  nameUz     String   @map("name_uz")
  nameRu     String   @map("name_ru")
  price      Decimal  @db.Decimal(10, 2)
  cost       Decimal? @db.Decimal(10, 2) // Purchase cost (admin only)
  stock      Decimal  @default(0) @db.Decimal(10, 3)
  minStock   Decimal  @default(0) @db.Decimal(10, 3) @map("min_stock")
  unit       String   @default("sht") // sht, kg, l, etc
  categoryId Int      @map("category_id")
  category   Category @relation(fields: [categoryId], references: [id])
  active     Boolean  @default(true)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  sales              SaleItem[]
  inventoryMovements InventoryArrival[]

  @@unique([storeId, barcode]) // Same barcode can exist in different stores
  @@index([storeId])
  @@map("products")
}

// ==================== SALES ====================

model Sale {
  id             String   @id @default(cuid())
  storeId        String   @map("store_id")
  store          Store    @relation(fields: [storeId], references: [id])
  receiptNumber  String   @map("receipt_number")
  totalAmount    Decimal  @map("total_amount") @db.Decimal(10, 2)
  discountAmount Decimal  @default(0) @map("discount_amount") @db.Decimal(10, 2)
  finalAmount    Decimal  @map("final_amount") @db.Decimal(10, 2)
  paymentMethod  String   @map("payment_method") // cash, card

  cashierId   String @map("cashier_id")
  cashierName String @map("cashier_name") // Denormalized for reports
  terminalId  String @map("terminal_id")  // TERMINAL_01, TERMINAL_02

  // Sync tracking
  synced   Boolean   @default(false)
  syncedAt DateTime? @map("synced_at")

  createdAt DateTime @default(now()) @map("created_at")

  items SaleItem[]

  @@unique([storeId, receiptNumber]) // Receipt numbers unique per store
  @@index([storeId])
  @@index([cashierId])
  @@index([terminalId])
  @@index([synced])
  @@index([createdAt])
  @@map("sales")
}

model SaleItem {
  id     String @id @default(cuid())
  saleId String @map("sale_id")
  sale   Sale   @relation(fields: [saleId], references: [id], onDelete: Cascade)

  productId Int     @map("product_id")
  product   Product @relation(fields: [productId], references: [id])

  productName String  @map("product_name") // Denormalized
  barcode     String
  quantity    Decimal @db.Decimal(10, 3) // 1.5 kg, etc
  unitPrice   Decimal @map("unit_price") @db.Decimal(10, 2)
  subtotal    Decimal @db.Decimal(10, 2)

  @@map("sale_items")
}

// ==================== INVENTORY MANAGEMENT ====================

model InventoryArrival {
  id        String  @id @default(cuid())
  storeId   String  @map("store_id")
  store     Store   @relation(fields: [storeId], references: [id])
  productId Int     @map("product_id")
  product   Product @relation(fields: [productId], references: [id])

  quantity  Decimal  @db.Decimal(10, 3)
  cost      Decimal  @db.Decimal(10, 2) // Purchase cost per unit
  totalCost Decimal  @map("total_cost") @db.Decimal(10, 2)

  supplierId String?   @map("supplier_id")
  supplier   Supplier? @relation(fields: [supplierId], references: [id])

  notes String? @db.Text

  createdBy String   @map("created_by") // User ID or Telegram ID
  createdAt DateTime @default(now()) @map("created_at")

  @@index([storeId])
  @@index([productId])
  @@index([createdAt])
  @@map("inventory_arrivals")
}

model Supplier {
  id      String  @id @default(cuid())
  storeId String  @map("store_id")
  store   Store   @relation(fields: [storeId], references: [id])
  nameUz  String  @map("name_uz")
  nameRu  String  @map("name_ru")
  phone   String?
  address String? @db.Text
  active  Boolean @default(true)

  categories Category[]
  arrivals   InventoryArrival[]

  createdAt DateTime @default(now()) @map("created_at")

  @@index([storeId])
  @@map("suppliers")
}

// ==================== SYSTEM SETTINGS ====================

model SystemSetting {
  id      String @id @default(cuid())
  storeId String @map("store_id")
  store   Store  @relation(fields: [storeId], references: [id])
  key     String
  value   String @db.Text

  updatedAt DateTime @updatedAt @map("updated_at")

  @@unique([storeId, key]) // Same key can exist in different stores
  @@index([storeId])
  @@map("system_settings")
}

model AuditLog {
  id       String  @id @default(cuid())
  storeId  String  @map("store_id")
  store    Store   @relation(fields: [storeId], references: [id])
  userId   String  @map("user_id")
  phone    String  @map("phone")
  action   String  // "create_product", "delete_sale", etc
  entity   String  // "product", "sale", "user"
  entityId String  @map("entity_id")
  details  String? @db.Text // JSON

  createdAt DateTime @default(now()) @map("created_at")

  @@index([storeId])
  @@index([userId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}
```

### SQLite Schema (POS Terminal - Offline First)

```prisma
// prisma/schema.sqlite.prisma

generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma-sqlite"
}

datasource db {
  provider = "sqlite"
  url      = env("SQLITE_DATABASE_URL")
}

// ==================== LOCAL STORE CONFIG ====================

model LocalConfig {
  id         String   @id @default("config")
  storeId    String   @map("store_id")
  storeName  String   @map("store_name")
  terminalId String   @map("terminal_id")
  apiUrl     String   @map("api_url")
  storePin   String?  @map("store_pin") // 4-digit PIN (bcrypt hashed) for quick cashier login
  lastSync   DateTime @default(now()) @map("last_sync")

  @@map("local_config")
}

// ==================== USER MANAGEMENT ====================

model User {
  id        String   @id @default(cuid())
  phone     String   @unique
  password  String
  role      String   @default("USER") // ADMIN, USER
  nameUz    String   @map("name_uz")
  nameRu    String   @map("name_ru")
  active    Boolean  @default(true)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("users")
}

// ==================== PRODUCTS & INVENTORY ====================

model Category {
  id        Int       @id @default(autoincrement())
  nameUz    String    @map("name_uz")
  nameRu    String    @map("name_ru")
  active    Boolean   @default(true)
  products  Product[]

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  @@map("categories")
}

model Product {
  id              Int      @id @default(autoincrement())
  barcode         String   @unique
  nameUz          String   @map("name_uz")
  nameRu          String   @map("name_ru")
  price           Decimal
  cost            Decimal?
  stock           Decimal  @default(0)
  minStock        Decimal  @default(0) @map("min_stock")
  unit            String   @default("шт")
  categoryId      Int      @map("category_id")
  category        Category @relation(fields: [categoryId], references: [id])
  supplierId      String?  @map("supplier_id")
  supplier        Supplier? @relation(fields: [supplierId], references: [id])
  productionDate  DateTime? @map("production_date")
  expiryDate      DateTime? @map("expiry_date")
  discountPercent       Decimal?  @default(0) @map("discount_percent")
  isOnPromotion         Boolean   @default(false) @map("is_on_promotion")
  pendingPrice          Decimal?  @map("pending_price")
  pendingPriceThreshold Decimal?  @map("pending_price_threshold")
  active                Boolean   @default(true)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  sales              SaleItem[]
  inventoryMovements InventoryArrival[]

  @@map("products")
}

// ==================== SALES ====================

model Sale {
  id             String   @id @default(cuid())
  receiptNumber  String   @unique @map("receipt_number")
  totalAmount    Decimal  @map("total_amount")
  discountAmount Decimal  @default(0) @map("discount_amount")
  finalAmount    Decimal  @map("final_amount")
  paymentMethod  String   @map("payment_method")

  cashierId   String @map("cashier_id")
  cashierName String @map("cashier_name")
  terminalId  String @map("terminal_id")

  synced   Boolean   @default(false)
  syncedAt DateTime? @map("synced_at")

  createdAt DateTime @default(now()) @map("created_at")

  items SaleItem[]

  @@index([synced])
  @@index([createdAt])
  @@map("sales")
}

model SaleItem {
  id          String  @id @default(cuid())
  saleId      String  @map("sale_id")
  sale        Sale    @relation(fields: [saleId], references: [id], onDelete: Cascade)

  productId   Int     @map("product_id")
  product     Product @relation(fields: [productId], references: [id])

  productName String  @map("product_name")
  barcode     String
  quantity    Decimal
  unitPrice   Decimal @map("unit_price")
  subtotal    Decimal

  @@map("sale_items")
}

// ==================== SYSTEM SETTINGS ====================

model SystemSetting {
  id        String   @id @default(cuid())
  key       String   @unique
  value     String

  updatedAt DateTime @updatedAt @map("updated_at")

  @@map("system_settings")
}

// ==================== INVENTORY MANAGEMENT ====================

model InventoryArrival {
  id        String   @id @default(cuid())
  productId Int      @map("product_id")
  product   Product  @relation(fields: [productId], references: [id])

  quantity  Decimal
  cost      Decimal
  totalCost Decimal  @map("total_cost")

  supplierId String?   @map("supplier_id")
  supplier   Supplier? @relation(fields: [supplierId], references: [id])

  notes String?

  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")

  @@index([productId])
  @@index([createdAt])
  @@map("inventory_arrivals")
}

model Supplier {
  id      String  @id @default(cuid())
  nameUz  String  @map("name_uz")
  nameRu  String  @map("name_ru")
  phone   String?
  address String?
  active  Boolean @default(true)
  balance Decimal @default(0) // Negative = we owe them, Positive = they owe us

  arrivals     InventoryArrival[]
  products     Product[]
  transactions SupplierTransaction[]

  createdAt DateTime @default(now()) @map("created_at")

  @@map("suppliers")
}

// ==================== SUPPLIER TRANSACTIONS ====================

model SupplierTransaction {
  id         String   @id @default(cuid())
  supplierId String   @map("supplier_id")
  supplier   Supplier @relation(fields: [supplierId], references: [id])

  type          String  // PURCHASE, PAYMENT, RETURN, ADVANCE, ADJUSTMENT
  paymentMethod String  @map("payment_method") // CASH, CARD, BANK_TRANSFER, INSTALLMENT, ONE_TO_ONE
  amount        Decimal
  description   String?

  referenceId   String? @map("reference_id")
  referenceType String? @map("reference_type")

  dueDate   DateTime? @map("due_date")
  paidAt    DateTime? @map("paid_at")

  createdBy String   @map("created_by")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  @@index([supplierId])
  @@index([type])
  @@index([createdAt])
  @@map("supplier_transactions")
}

// ==================== AUDIT LOG ====================

model AuditLog {
  id       String  @id @default(cuid())
  userId   String  @map("user_id")
  phone    String
  action   String
  entity   String
  entityId String  @map("entity_id")
  details  String?

  createdAt DateTime @default(now()) @map("created_at")

  @@index([userId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}

// ==================== SYNC QUEUE ====================

model SyncQueue {
  id        String   @id @default(cuid())
  entity    String
  entityId  String   @map("entity_id")
  action    String
  payload   String
  attempts  Int      @default(0)
  lastError String?  @map("last_error")

  createdAt DateTime @default(now()) @map("created_at")

  @@index([entity])
  @@map("sync_queue")
}
```

### Database Differences

| Feature | SQLite (POS) | PostgreSQL (VPS) |
|---------|-------------|------------------|
| **Purpose** | Local cache, offline work | Master database, multi-tenant |
| **Multi-tenancy** | Single store via LocalConfig | Full multi-tenant with Store model |
| **Data Scope** | Products, sales, suppliers, inventory for one store | All stores' data |
| **Size** | ~10-50 MB | Grows over time |
| **Sync** | Every 5 min via SyncQueue | Real-time updates |
| **Backup** | Auto-created daily | Automated + manual |
| **Inventory/Suppliers** | Stored locally (arrivals, suppliers, transactions) | Full history per store |
| **Audit Logs** | Stored locally | Full audit trail per store |
| **PIN Login** | storePin in LocalConfig (bcrypt hashed) | N/A |

### Key Schema Changes Summary

| Model | Change | Description |
|-------|--------|-------------|
| **Store** | New (PostgreSQL) | Central entity for multi-tenancy |
| **UserRole** | Updated | Added SUPER_ADMIN role |
| **User** | Updated | storeId nullable (null for SUPER_ADMIN), phone unique per store |
| **Category** | Updated | Added storeId, suppliers relation |
| **Product** | Updated | Added storeId, supplierId, productionDate, expiryDate, discountPercent, isOnPromotion, pendingPrice, pendingPriceThreshold. Barcode unique per store. Unit default "шт" |
| **Sale** | Updated | Added storeId, receiptNumber unique per store |
| **InventoryArrival** | Updated | Added storeId (PostgreSQL). Now stored locally in SQLite too |
| **Supplier** | Updated | Added storeId (PostgreSQL), balance field, transactions relation. Now stored locally in SQLite too |
| **SupplierTransaction** | New | Full supplier transaction tracking (PURCHASE, PAYMENT, RETURN, ADVANCE, ADJUSTMENT) with payment methods. Stored in both SQLite and PostgreSQL |
| **SystemSetting** | Updated | Added storeId, key unique per store |
| **AuditLog** | Updated | Added storeId, changed userName to phone. Now stored locally in SQLite too |
| **LocalConfig** | New (SQLite) | Stores terminal's store assignment + storePin for PIN login |
| **SyncQueue** | New (SQLite) | Tracks pending sync operations |

---

## Features by Role

### SUPER_ADMIN Features

#### Store Management
```typescript
- Create new stores
- Edit store settings (name, address, phone)
- Deactivate/activate stores
- View all stores' data
- Configure store-specific settings (tax rate, receipt template)
```

#### Cross-Store Analytics
```typescript
- View combined revenue across all stores
- Compare store performance
- View cross-store product performance
- Access system-wide reports
```

### ADMIN Features (Store Scoped)

#### Product Management
```typescript
// Admin can perform all CRUD operations for their store
- Add new products with barcode
- Edit product details (name, price, category)
- Delete products (soft delete)
- Adjust stock levels manually
- Set minimum stock alerts
- View purchase cost and profit margins
- Bulk import products from CSV
```

#### User Management
```typescript
- Create new cashier accounts for their store
- Assign roles (Admin/User)
- Activate/deactivate users
- Reset passwords
- View user activity logs
- Track cashier performance
```

#### Inventory Management
```typescript
- Record inventory arrivals
- Manage suppliers (with category associations)
- View stock history
- Generate low-stock alerts
- Adjust inventory levels
```

#### Analytics & Reports
```typescript
- Daily sales summary (all cashiers)
- Monthly revenue reports
- Product performance analysis
- Profit/loss calculations
- Best-selling products
- Hourly sales patterns
- Cashier performance comparison
- Export reports to Excel/PDF
```

#### Store Settings
```typescript
- Configure tax rates
- Set receipt templates
- Manage printer settings
- Configure sync intervals
- Store backup/restore
- Telegram bot configuration
```

### USER (Cashier) Features

#### POS Operations
```typescript
- Scan products via barcode
- Manual product search
- Add items to cart
- Adjust quantities
- Apply pre-set discounts (if allowed)
- Select payment method
- Process payment
- Print receipt
- Void items (own sales only)
```

#### Product Lookup
```typescript
- Search products by name/barcode
- View product details
- Check stock availability
- View prices
- Read-only access
```

#### Limited Reports
```typescript
- View own shift sales (today only)
- Daily summary (own sales)
- Receipt reprints (own sales)
- Cannot access historical data
- Cannot export reports
```

#### Personal Settings
```typescript
- Change own password
- Select language (RU/UZ)
- Choose theme (Dark/Light)
- View own profile
```

---

## API Endpoints

### Authentication

```typescript
POST   /api/auth/login
Body:  { phone: string, password: string, storeId?: string }
Response: { token: string, user: UserDto, store: StoreDto }

POST   /api/auth/logout
Headers: Authorization: Bearer <token>
Response: { success: boolean }

GET    /api/auth/profile
Headers: Authorization: Bearer <token>
Response: UserDto (includes storeId, role)
```

### Stores (Super Admin Only)

```typescript
GET    /api/stores                   // Super Admin only
Response: Store[]

POST   /api/stores                   // Super Admin only
Body:  CreateStoreDto
Response: Store

GET    /api/stores/:id               // Super Admin only
Response: Store

PATCH  /api/stores/:id               // Super Admin only
Body:  UpdateStoreDto
Response: Store

DELETE /api/stores/:id               // Super Admin only (soft delete)
Response: { success: boolean }
```

### Products

```typescript
GET    /api/products
Query: ?category=<id>&active=true
Headers: Authorization: Bearer <token>
Response: Product[] (filtered by user's storeId)

GET    /api/products/:id
Response: Product

POST   /api/products              // Admin only
Body:  CreateProductDto
Response: Product (created in user's store)

PATCH  /api/products/:id          // Admin only
Body:  UpdateProductDto
Response: Product

DELETE /api/products/:id          // Admin only (soft delete)
Response: { success: boolean }

POST   /api/products/bulk-import  // Admin only
Body:  FormData (CSV file)
Response: { imported: number, failed: number }
```

### Sales

```typescript
POST   /api/sales/sync
Body:  { sale: SaleDto, items: SaleItemDto[], storeId: string }
Headers: Authorization: Bearer <token>
Response: { id: string, synced: true }

GET    /api/sales
Query: ?startDate=<date>&endDate=<date>&cashierId=<id>
Headers: Authorization: Bearer <token>
Response: Sale[] (filtered by storeId)
// Users see only own sales, Admins see all for their store

GET    /api/sales/:id
Response: Sale with items
```

### Inventory

```typescript
POST   /api/inventory/arrivals    // Admin only
Body:  CreateArrivalDto
Response: InventoryArrival (created in user's store)

GET    /api/inventory/arrivals    // Admin only
Query: ?productId=<id>&startDate=<date>
Response: InventoryArrival[] (filtered by storeId)

GET    /api/inventory/low-stock   // Admin only
Response: Product[] (where stock < minStock for user's store)
```

### Suppliers

```typescript
GET    /api/suppliers             // Admin only
Response: Supplier[] (filtered by storeId)

POST   /api/suppliers             // Admin only
Body:  CreateSupplierDto
Response: Supplier

PATCH  /api/suppliers/:id         // Admin only
Body:  UpdateSupplierDto
Response: Supplier

DELETE /api/suppliers/:id         // Admin only
Response: { success: boolean }
```

### Analytics

```typescript
GET    /api/analytics/daily       // Admin only
Query: ?date=<date>
Response: {
  totalSales: number,
  totalRevenue: Decimal,
  transactionCount: number,
  topProducts: Product[],
  salesByCashier: {...}
} // Scoped to user's store

GET    /api/analytics/monthly     // Admin only
Query: ?year=<year>&month=<month>
Response: MonthlyAnalyticsDto

GET    /api/analytics/product-performance // Admin only
Query: ?startDate=<date>&endDate=<date>
Response: ProductPerformanceDto[]

GET    /api/analytics/cross-store // Super Admin only
Query: ?startDate=<date>&endDate=<date>
Response: CrossStoreAnalyticsDto
```

### Users

```typescript
GET    /api/users                 // Admin only (returns store users)
Response: User[]

POST   /api/users                 // Admin only
Body:  CreateUserDto
Response: User (created in user's store)

PATCH  /api/users/:id             // Admin or own profile
Body:  UpdateUserDto
Response: User

DELETE /api/users/:id             // Admin only
Response: { success: boolean }
```

---

## Development Setup

### Prerequisites

```bash
# Required software
- Node.js 20+
- npm or pnpm
- Git
- PostgreSQL 15+ (for VPS development)
- SQLite (included with better-sqlite3)
```

### Initial Setup

```bash
# 1. Clone repository
git clone https://github.com/your-username/grocery-pos.git
cd grocery-pos

# 2. Install dependencies
npm install

# 3. Setup environment files
cp .env.example .env.pos
cp .env.example .env.server

# 4. Configure .env.pos (POS Terminal)
DATABASE_PROVIDER="sqlite"
DATABASE_URL="file:./pos-local.db"
VPS_API_URL="http://localhost:3000/api"  # Or your VPS domain
TERMINAL_ID="TERMINAL_DEV"
STORE_ID="dev-store-id"  # Assigned store ID

# 5. Configure .env.server (VPS Backend)
DATABASE_PROVIDER="postgresql"
DATABASE_URL="postgresql://user:password@localhost:5432/grocery_pos"
JWT_SECRET="your-development-secret-key"
TELEGRAM_BOT_TOKEN="your-bot-token"  # Optional for now

# 6. Generate Prisma clients (both PostgreSQL and SQLite)
npm run prisma:generate
npm run prisma:generate:sqlite

# 7. Run migrations
npm run prisma:migrate:dev

# 8. Seed database
npm run prisma:seed
```

### Development Commands

```bash
# Terminal 1: Run VPS Backend (NestJS)
npm run dev:server
# Runs on http://localhost:3000

# Terminal 2: Run POS Frontend (Electron)
npm run dev:pos
# Opens Electron window

# Other useful commands
npm run lint              # Lint code
npm run format            # Format with Prettier
npm run test              # Run tests
npm run prisma:studio     # Open Prisma Studio GUI
```

### Project Scripts (package.json)

```json
{
  "scripts": {
    "dev:pos": "cross-env APP_MODE=pos electron-vite dev",
    "dev:server": "nest start --watch",

    "build:pos": "cross-env APP_MODE=pos electron-vite build && electron-builder",
    "build:server": "nest build",

    "prisma:generate": "prisma generate",
    "prisma:generate:sqlite": "prisma generate --schema=prisma/schema.sqlite.prisma",
    "prisma:migrate:dev": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:push:sqlite": "prisma db push --schema=prisma/schema.sqlite.prisma",
    "prisma:studio": "prisma studio",
    "prisma:studio:sqlite": "prisma studio --schema=prisma/schema.sqlite.prisma",
    "prisma:seed": "tsx prisma/seed.ts",

    "lint": "eslint src --ext .ts,.tsx",
    "format": "prettier --write \"src/**/*.{ts,tsx,json}\"",
    "test": "jest",
    "test:watch": "jest --watch"
  }
}
```

---

## Building & Deployment

### Building POS Desktop App (.exe)

```bash
# 1. Build for Windows
npm run build:pos

# Output location:
# dist/Grocery-POS-Setup-1.0.0.exe (~100-150MB)

# 2. Test the installer
# Right-click .exe -> Run as Administrator -> Install

# 3. App installs to:
# C:\Program Files\Grocery POS\

# 4. Desktop shortcut created automatically
```

#### Electron Builder Config

```javascript
// electron-builder.config.js
module.exports = {
  appId: 'com.grocery.pos',
  productName: 'Grocery POS',
  directories: {
    output: 'dist',
    buildResources: 'build'
  },
  files: [
    'dist-electron/**/*',
    'dist-renderer/**/*'
  ],
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    icon: 'build/icon.ico'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
  }
}
```

### Building VPS Backend

```bash
# 1. Build NestJS
npm run build:server

# Output: dist/server/

# 2. Create Docker image
docker build -t grocery-pos-api:latest .

# 3. Test locally
docker-compose up -d
```

### Deploying to Contabo VPS

```bash
# Method 1: Manual Deployment
# ======================================

# 1. SSH into VPS
ssh root@your-vps-ip

# 2. Create project directory
mkdir -p /opt/grocery-pos
cd /opt/grocery-pos

# 3. Clone repository (or upload files)
git clone https://github.com/your-username/grocery-pos.git .

# 4. Copy environment file
cp .env.example .env
nano .env  # Edit with production values

# 5. Build and start services
docker-compose up -d

# 6. Check logs
docker-compose logs -f


# Method 2: Automated Deployment Script
# ======================================

# Local machine:
./scripts/deploy-vps.sh
```

#### Docker Compose (VPS)

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: grocery-pos-db
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: grocery_pos
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: always
    networks:
      - grocery-network

  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: grocery-pos-api
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/grocery_pos
      JWT_SECRET: ${JWT_SECRET}
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
    ports:
      - "3000:3000"
    depends_on:
      - postgres
    restart: always
    networks:
      - grocery-network

  nginx:
    image: nginx:alpine
    container_name: grocery-pos-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - api
    restart: always
    networks:
      - grocery-network

volumes:
  postgres_data:

networks:
  grocery-network:
    driver: bridge
```

#### Nginx Configuration

```nginx
# nginx.conf
events {
    worker_connections 1024;
}

http {
    upstream api {
        server api:3000;
    }

    server {
        listen 80;
        server_name your-domain.com;

        # Redirect HTTP to HTTPS
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name your-domain.com;

        ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

        location /api/ {
            proxy_pass http://api/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}
```

### SSL Certificate Setup

```bash
# On VPS
# 1. Install Certbot
apt update
apt install certbot python3-certbot-nginx

# 2. Get certificate
certbot --nginx -d your-domain.com

# 3. Auto-renewal (already set up by Certbot)
certbot renew --dry-run
```

---

## Configuration

### Environment Variables

#### POS Terminal (.env.pos)

```bash
# App Mode
APP_MODE=pos

# Database
DATABASE_PROVIDER=sqlite
SQLITE_DATABASE_URL=file:./pos-local.db

# VPS Connection
VPS_API_URL=https://your-domain.com/api
# For local development: http://localhost:3000/api

# Terminal Identity
TERMINAL_ID=T1
STORE_ID=your-store-cuid
# Use different TERMINAL_ID for each machine in the same store

# Sync Settings
SYNC_INTERVAL_MS=300000  # 5 minutes
RETRY_INTERVAL_MS=60000  # 1 minute on failure

# Printer (optional)
PRINTER_NAME=TM-T20II
PRINTER_TYPE=thermal
```

#### VPS Server (.env.server)

```bash
# App Mode
APP_MODE=server

# Database
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://grocery_user:secure_password@localhost:5432/grocery_pos

# JWT Authentication
JWT_SECRET=your-very-secure-secret-key-minimum-32-chars
JWT_EXPIRES_IN=8h

# Telegram Bot (optional)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_ADMIN_ID=987654321

# Server
PORT=3000
NODE_ENV=production

# CORS (POS terminals)
CORS_ORIGINS=*
# Production: Limit to specific IPs

# Rate Limiting
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100
```

### Store Settings (Stored in DB per Store)

```typescript
// Store.settings JSON field
interface StoreSettings {
  // Business
  taxRate: number;      // e.g., 0.12 for 12%
  currency: string;     // "UZS"

  // Receipt
  receiptHeader: string;
  receiptFooter: string;
  printLogo: boolean;

  // Sync
  syncInterval: number;  // minutes
  autoBackup: boolean;
  backupTime: string;    // "02:00" for 2 AM

  // Features
  allowDiscounts: boolean;
  requireCashierPassword: boolean;
  enableLowStockAlerts: boolean;
  lowStockThreshold: number;
}

// Per-store SystemSettings (key-value)
interface SystemSettings {
  last_product_sync: string;   // ISO timestamp
  last_sale_sync: string;      // ISO timestamp
  receipt_counter: string;     // Current receipt number
}
```

### LocalConfig (SQLite - Terminal Identity)

```typescript
// Stored in local SQLite after initial setup
interface LocalConfig {
  id: "config";           // Singleton
  storeId: string;        // Assigned store CUID
  storeName: string;      // Store name for display
  terminalId: string;     // T1, T2, etc.
  apiUrl: string;         // VPS API URL
  storePin?: string;      // 4-digit PIN (bcrypt hashed) for quick cashier login
  lastSync: DateTime;     // Last successful sync
}
```

---

## Security

### Authentication

```typescript
// JWT-based authentication
// Token includes storeId for multi-tenant isolation
// Token stored in localStorage
// Expires after 8 hours

interface JwtPayload {
  sub: string;        // userId
  storeId: string | null;  // null for SUPER_ADMIN
  role: UserRole;
  phone: string;
  iat: number;
  exp: number;
}

// Password hashing
import * as bcrypt from 'bcrypt';
const saltRounds = 10;
const hashedPassword = await bcrypt.hash(plainPassword, saltRounds);
```

### Role-Based Access Control (RBAC)

```typescript
// NestJS Guard with Store Isolation
@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<UserRole[]>(
      'roles',
      context.getHandler()
    );

    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.includes(user.role);
  }
}

// Store Guard - Ensures data isolation
@Injectable()
export class StoreGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();

    // SUPER_ADMIN can access all stores
    if (user.role === 'SUPER_ADMIN') return true;

    // Others must have storeId matching request
    const requestStoreId = context.switchToHttp().getRequest().params.storeId
      || context.switchToHttp().getRequest().body.storeId;

    return user.storeId === requestStoreId;
  }
}

// Usage in controller
@Post('products')
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard, StoreGuard)
createProduct(@Body() dto: CreateProductDto, @CurrentStore() storeId: string) {
  return this.productsService.create(dto, storeId);
}
```

### Data Protection

```typescript
// Sensitive fields excluded from API responses
export class UserDto {
  id: string;
  storeId: string;
  phone: string;
  role: UserRole;
  nameRu: string;
  nameUz: string;
  // password excluded
}

// Audit logging for admin actions (per store)
await this.prisma.auditLog.create({
  data: {
    storeId: user.storeId,
    userId: user.id,
    phone: user.phone,
    action: 'delete_product',
    entity: 'product',
    entityId: productId,
    details: JSON.stringify({ name: product.nameRu })
  }
});
```

### Network Security

```bash
# VPS Firewall (UFW)
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow http
ufw allow https
ufw enable

# Fail2Ban (protect against brute force)
apt install fail2ban
systemctl enable fail2ban
```

### Offline Security

```typescript
// Local SQLite is encrypted at rest (optional)
// Passwords never stored in plaintext
// JWT tokens have short expiry
// Auto-logout after inactivity (30 minutes)
// SyncQueue encrypts sensitive payload data
```

---

## Sync Mechanism

### Sync Flow Diagram

```
POS Terminal                                    VPS Server
+------------------+                           +------------------+
|  SQLite          |                           |  PostgreSQL      |
|  synced=false    |                           |  (Multi-tenant)  |
|  SyncQueue       |                           |                  |
+--------+---------+                           +--------+---------+
         |                                              ^
         |                                              |
         v                                              |
+---------------------------------------------------------------------+
|              Sync Service (runs every 5 min)                         |
|                                                                       |
|  1. Read LocalConfig to get storeId                                   |
|  2. Query local sales where synced=false                              |
|  3. Check SyncQueue for pending items                                 |
|  4. Batch sales (max 50 per request)                                  |
|  5. POST /api/sales/sync with JWT token + storeId                     |
|  6. On success: Mark local sales as synced, remove from SyncQueue     |
|  7. On failure: Increment attempts in SyncQueue, store lastError      |
|                                                                       |
|  8. GET /api/products?storeId=<storeId> (check for updates)           |
|  9. Compare updatedAt timestamps                                      |
|  10. Download changed products for this store                         |
|  11. Upsert into local SQLite                                         |
|  12. Update LocalConfig.lastSync                                      |
|  13. Notify UI if products changed                                    |
+---------------------------------------------------------------------+
```

### SyncQueue Implementation

```typescript
// src/main/sync/queue-manager.ts

export class QueueManager {
  async addToQueue(entity: string, entityId: string, action: string, payload: object) {
    await prisma.syncQueue.create({
      data: {
        entity,
        entityId,
        action,
        payload: JSON.stringify(payload),
        attempts: 0
      }
    });
  }

  async getQueuedItems(maxItems = 50) {
    return prisma.syncQueue.findMany({
      where: {
        attempts: { lt: 5 } // Max 5 retry attempts
      },
      orderBy: { createdAt: 'asc' },
      take: maxItems
    });
  }

  async markSuccess(id: string) {
    await prisma.syncQueue.delete({ where: { id } });
  }

  async markFailed(id: string, error: string) {
    await prisma.syncQueue.update({
      where: { id },
      data: {
        attempts: { increment: 1 },
        lastError: error
      }
    });
  }

  async cleanupOldItems() {
    // Remove items with 5+ failed attempts (older than 24h)
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.syncQueue.deleteMany({
      where: {
        attempts: { gte: 5 },
        createdAt: { lt: cutoff }
      }
    });
  }
}
```

### Sync Service Implementation

```typescript
// src/main/sync/sync-service.ts

export class SyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private queueManager = new QueueManager();

  async getConfig(): Promise<LocalConfig> {
    const config = await prisma.localConfig.findUnique({
      where: { id: 'config' }
    });
    if (!config) throw new Error('Terminal not configured');
    return config;
  }

  start() {
    console.log('Sync service started');

    // Initial sync
    this.sync();

    // Periodic sync (5 minutes)
    this.syncInterval = setInterval(() => {
      this.sync();
    }, 5 * 60 * 1000);
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }

  async sync() {
    if (this.isSyncing) {
      console.log('Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;

    try {
      const config = await this.getConfig();

      // Check internet connectivity
      const isOnline = await this.checkConnectivity(config.apiUrl);
      if (!isOnline) {
        console.log('No internet connection, skipping sync');
        return;
      }

      // Sync sales (upload)
      await this.syncSales(config);

      // Process sync queue
      await this.processSyncQueue(config);

      // Sync products (download)
      await this.syncProducts(config);

      // Update last sync time
      await prisma.localConfig.update({
        where: { id: 'config' },
        data: { lastSync: new Date() }
      });

      console.log('Sync completed successfully');

      // Notify renderer process
      BrowserWindow.getAllWindows()[0]?.webContents.send('sync:completed');

    } catch (error) {
      console.error('Sync failed:', error);

      // Notify renderer about error
      BrowserWindow.getAllWindows()[0]?.webContents.send('sync:failed', {
        message: error.message
      });

    } finally {
      this.isSyncing = false;
    }
  }

  private async syncSales(config: LocalConfig) {
    // Get unsynced sales
    const unsyncedSales = await prisma.sale.findMany({
      where: { synced: false },
      include: { items: true },
      take: 50  // Batch limit
    });

    if (unsyncedSales.length === 0) return;

    console.log(`Syncing ${unsyncedSales.length} sales...`);

    for (const sale of unsyncedSales) {
      try {
        const token = await this.getAuthToken();

        const response = await fetch(config.apiUrl + '/sales/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            ...sale,
            storeId: config.storeId,
            terminalId: config.terminalId
          })
        });

        if (response.ok) {
          // Mark as synced
          await prisma.sale.update({
            where: { id: sale.id },
            data: {
              synced: true,
              syncedAt: new Date()
            }
          });

          console.log(`Sale ${sale.id} synced successfully`);
        } else {
          console.error(`Failed to sync sale ${sale.id}:`, await response.text());
        }

      } catch (error) {
        console.error(`Error syncing sale ${sale.id}:`, error);
        // Will retry on next sync cycle
      }
    }
  }

  private async syncProducts(config: LocalConfig) {
    try {
      const token = await this.getAuthToken();

      // Get last sync timestamp
      const lastSync = await this.getLastProductSync();

      const response = await fetch(
        config.apiUrl + `/products?updatedAfter=${lastSync}&storeId=${config.storeId}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }

      const products = await response.json();

      if (products.length === 0) {
        console.log('No product updates');
        return;
      }

      console.log(`Updating ${products.length} products...`);

      // Upsert products
      for (const product of products) {
        await prisma.product.upsert({
          where: { id: product.id },
          update: {
            nameRu: product.nameRu,
            nameUz: product.nameUz,
            price: product.price,
            stock: product.stock,
            categoryId: product.categoryId,
            active: product.active,
            updatedAt: new Date(product.updatedAt)
          },
          create: {
            id: product.id,
            barcode: product.barcode,
            nameRu: product.nameRu,
            nameUz: product.nameUz,
            price: product.price,
            cost: product.cost,
            stock: product.stock,
            minStock: product.minStock,
            unit: product.unit,
            categoryId: product.categoryId,
            active: product.active
          }
        });
      }

      // Update last sync timestamp
      await this.setLastProductSync(new Date().toISOString());

      console.log('Products updated successfully');

    } catch (error) {
      console.error('Failed to sync products:', error);
    }
  }
}
```

### Conflict Resolution

```typescript
// Last-Write-Wins strategy
// VPS timestamp is source of truth
// Products always sync from server -> local
// Sales always sync from local -> server

// Stock updates: Server is authoritative
// If local stock was changed, queue a stock update for manual review
```

---

## Internationalization (i18n)

### Setup

```typescript
// src/renderer/i18n/index.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import uz from './locales/uz.json';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
      uz: { translation: uz }
    },
    lng: localStorage.getItem('language') || 'ru',
    fallbackLng: 'ru',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
```

### Translation Namespaces

Both `ru.json` and `uz.json` contain the following 18 namespaces:

| Namespace | Description |
|-----------|-------------|
| `common` | save, cancel, delete, edit, search, loading, error, success, close, clear, remove, currency, confirmDelete, etc. |
| `auth` | login, logout, phone, password, enterPin, usePhoneLogin, switchUser |
| `nav` | pos, products, reports, dailySummary, monthlyReport, analytics, inventory, users, settings, collapse/expand |
| `pos` | scanBarcode, cart, checkout, payment, receipt, salesHistory, multi-tab, editingSale, printReceipt, etc. |
| `products` | name, price, stock, category, barcode, productionDate, expiryDate, discountPercent, isOnPromotion, pendingPrice, etc. |
| `inventory` | stockManagement, addArrival, newArrival, costPerUnit, deferred price logic messages |
| `reports` | daily/monthly reports, revenue, profit, analytics |
| `users` | user management fields including address |
| `settings` | store info, tax rate, sync settings, receiptSettings |
| `filters` | supplier, balance, weOwe, theyOwe, stock status, category, date range |
| `errors` | productNotFound, productInactive, insufficientStock |
| `sync` | syncing, lastSync, notSynced |
| `categories` | title, nameRu, nameUz, CRUD confirmations |
| `units` | piece (шт), kg (кг), liter (л), meter (м) |
| `priceTags` | price tag template builder UI keys |
| `suppliers` | supplier list, form, details, transactions, balance, payment methods |
| `receipt` | receipt format settings, paper width (80mm/58mm), language, header/footer, preview |
| `printer` | availablePrinters, selected, testPrint, testing |

### Usage in Components

```typescript
import { useTranslation } from 'react-i18next';

function ProductList() {
  const { t, i18n } = useTranslation();

  const changeLanguage = (lang: 'ru' | 'uz') => {
    i18n.changeLanguage(lang);
    localStorage.setItem('language', lang);
  };

  return (
    <div>
      <h1>{t('products.title')}</h1>

      <select onChange={(e) => changeLanguage(e.target.value as 'ru' | 'uz')}>
        <option value="ru">Русский</option>
        <option value="uz">O'zbekcha</option>
      </select>

      <table>
        <thead>
          <tr>
            <th>{t('products.name')}</th>
            <th>{t('products.price')}</th>
            <th>{t('products.stock')}</th>
          </tr>
        </thead>
        {/* ... */}
      </table>
    </div>
  );
}
```

### Database Multi-language

```typescript
// Products have both languages stored
// Display based on current language

const currentLang = i18n.language;
const productName = currentLang === 'uz' ? product.nameUz : product.nameRu;
```

---

## Theming (Dark/Light Mode)

### Theme Provider

```typescript
// src/renderer/theme/ThemeProvider.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ThemeProvider as StyledThemeProvider } from 'styled-components';
import { darkTheme, lightTheme, Theme } from './themes';
import { GlobalStyles } from './GlobalStyles';

type ThemeMode = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  mode: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('theme') as ThemeMode) || 'light';
  });

  const theme = mode === 'dark' ? darkTheme : lightTheme;

  const toggleTheme = () => {
    const newMode = mode === 'dark' ? 'light' : 'dark';
    setMode(newMode);
    localStorage.setItem('theme', newMode);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  return (
    <ThemeContext.Provider value={{ theme, mode, toggleTheme }}>
      <StyledThemeProvider theme={theme}>
        <GlobalStyles />
        {children}
      </StyledThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
}
```

### Theme Definitions

```typescript
// src/renderer/theme/themes.ts
export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    border: string;
    success: string;
    error: string;
    warning: string;
    info: string;
  };
  spacing: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
  };
  borderRadius: string;
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
}

export const lightTheme: Theme = {
  colors: {
    primary: '#1976d2',
    secondary: '#dc004e',
    background: '#f5f5f5',
    surface: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    border: '#e0e0e0',
    success: '#4caf50',
    error: '#f44336',
    warning: '#ff9800',
    info: '#2196f3',
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
  borderRadius: '8px',
  shadows: {
    sm: '0 1px 3px rgba(0,0,0,0.12)',
    md: '0 4px 6px rgba(0,0,0,0.16)',
    lg: '0 10px 20px rgba(0,0,0,0.19)',
  },
};

export const darkTheme: Theme = {
  colors: {
    primary: '#90caf9',
    secondary: '#f48fb1',
    background: '#121212',
    surface: '#1e1e1e',
    text: '#ffffff',
    textSecondary: '#b0b0b0',
    border: '#333333',
    success: '#66bb6a',
    error: '#ef5350',
    warning: '#ffa726',
    info: '#42a5f5',
  },
  spacing: lightTheme.spacing,
  borderRadius: '8px',
  shadows: {
    sm: '0 1px 3px rgba(0,0,0,0.5)',
    md: '0 4px 6px rgba(0,0,0,0.6)',
    lg: '0 10px 20px rgba(0,0,0,0.7)',
  },
};
```

---

## Future Enhancements

### Phase 1 (Core - Completed)
- Basic POS operations with multi-tab support
- Product management (full CRUD + analytics + filters)
- User roles (Super Admin/Admin/User)
- **Multi-tenant architecture**
- VPS sync with store isolation
- i18n (RU/UZ) with 18 namespaces
- Dark/Light theme
- Receipt printing (HTML-based with customizable templates)
- SyncQueue for reliable offline sync
- PIN-based quick login
- Virtual keyboard for touch screens

### Phase 2 (Partially Completed)
- [x] Supplier management (full CRUD + balance tracking + transactions)
- [x] Discount/promotion engine (discountPercent, isOnPromotion, pendingPrice with threshold)
- [x] Price tag printing (customizable templates)
- [x] Receipt settings (format, language, header/footer, live preview, 80mm/58mm support)
- [x] Product analytics (top selling, performance metrics)
- [x] Sales history with edit/delete capability
- [x] Category management modal
- [x] Inventory arrival with deferred price logic
- [x] Uzbek Latin ↔ Cyrillic transliteration
- [ ] Telegram bot for inventory management (per store)
- [ ] Advanced analytics dashboard
- [ ] Customer loyalty program
- [ ] Shift management
- [ ] Auto-updater for desktop app

### Phase 3 (Future)
- [ ] Mobile app for managers (React Native)
- [ ] Accounting integration
- [ ] Kitchen display system (for restaurants)
- [ ] Cross-store inventory transfers

---

## Troubleshooting

### Common Issues

#### Issue: Terminal not configured

```bash
# The LocalConfig table is empty
# Run initial setup:
1. Login to POS app
2. Select store from dropdown (fetched from VPS)
3. App will create LocalConfig entry

# Or manually in SQLite:
INSERT INTO local_config (id, store_id, store_name, terminal_id, api_url)
VALUES ('config', 'your-store-cuid', 'Store Name', 'T1', 'https://api.example.com');
```

#### Issue: POS app won't connect to VPS

```bash
# Check VPS_API_URL in .env.pos
# Verify VPS is accessible
ping your-domain.com

# Check if API is running
curl https://your-domain.com/api/health

# Check firewall
# Ensure ports 80/443 are open on VPS
```

#### Issue: Sync not working

```bash
# Check sync logs in app
# Open DevTools: Ctrl+Shift+I
# Go to Console tab
# Look for "Sync failed" messages

# Check SyncQueue for stuck items:
SELECT * FROM sync_queue WHERE attempts >= 5;

# Common causes:
# 1. Invalid JWT token -> Re-login
# 2. Network timeout -> Check internet
# 3. API endpoint changed -> Update LocalConfig.apiUrl
# 4. Store ID mismatch -> Verify LocalConfig.storeId
```

#### Issue: Products from wrong store

```bash
# Check LocalConfig storeId
SELECT * FROM local_config;

# Verify it matches your assigned store
# If wrong, delete local database and re-setup
```

#### Issue: Receipt printer not working

```bash
# Check printer name
# Control Panel -> Devices -> Printers
# Update PRINTER_NAME in settings

# Test print
# Use Windows test print feature first

# Common fixes:
# 1. Install correct driver
# 2. Set as default printer
# 3. Check USB connection
```

#### Issue: SQLite database locked

```bash
# Close app completely
# Delete pos-local.db-journal file if exists
# Restart app

# Prevention:
# Don't force close app
# Use File -> Exit properly
```

### Debug Mode

```bash
# Enable debug logging
# .env.pos
DEBUG=true
LOG_LEVEL=debug

# Logs location:
# Windows: C:\Users\<username>\AppData\Local\Grocery POS\logs\
```

### Support

For technical support:
- **Email:** support@your-domain.com
- **Telegram:** @your_support_bot
- **Phone:** +998 XX XXX XX XX

---

## Contact & Contribution

### Developer
- **Name:** Bobur
- **Location:** Fergana, Uzbekistan
- **GitHub:** [@bobur-dev](https://github.com/bobur-dev)
- **Email:** bobur.dev@example.com

### License
This project is proprietary software. All rights reserved.

---

**Last Updated:** February 18, 2026
**Version:** 2.1.0
**Status:** Development (Multi-Tenant, Feature-Rich POS)

---

## Additional Resources

- [Prisma Documentation](https://www.prisma.io/docs)
- [NestJS Documentation](https://docs.nestjs.com)
- [Electron Documentation](https://www.electronjs.org/docs)
- [React i18next](https://react.i18next.com)
- [Styled Components](https://styled-components.com)

---

*This documentation will be updated as the project evolves.*
