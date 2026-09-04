import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Layout } from "./components/layout/Layout";
import { ProtectedRoute } from "./components/protected/ProtectedRoute";
import { RoleGuard } from "./components/protected/RoleGuard";
import { ModeGuard } from "./components/protected/ModeGuard";
import { useAuthStore } from "./store/auth-store";
import { ConfirmDialog } from "./components/common/ConfirmDialog";

// Pages
import { PinLoginPage } from "./pages/Login/PinLoginPage";
import { SetupPinPage } from "./pages/Login/SetupPinPage";
import { POSScreen } from "./pages/POS/POSScreen";
import { ProductList } from "./pages/Products/ProductList";
import { ProductDetails } from "./pages/Products/ProductDetails";
import { StockManagement } from "./pages/Products/StockManagement";
import { MarkingCheckPage } from "./pages/Marking/MarkingCheckPage";
import { DailySummary } from "./pages/Reports/DailySummary";
import { MonthlyReport } from "./pages/Reports/MonthlyReport";
import { Analytics } from "./pages/Reports/Analytics";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import { UserSettings } from "./pages/Settings/UserSettings";
import { SystemSettings } from "./pages/Settings/SystemSettings";
import { PriceTags } from "./pages/Settings/PriceTags";
import { PrinterSettings } from "./pages/Settings/PrinterSettings";
import { ReceiptSettings } from "./pages/Settings/ReceiptSettings";
import { UserList } from "./pages/Users/UserList";
import { UserForm } from "./pages/Users/UserForm";
import { SupplierList, SupplierDetails } from "./pages/Suppliers";
import { WeighedInventoryPage } from "./pages/Inventory/WeighedInventoryPage";
import { ScaleSettings } from "./pages/Settings/ScaleSettings";
import { FiscalSettings } from "./pages/Settings/FiscalSettings";
import { SyncSettings } from "./pages/Settings/SyncSettings";
import { TerminalStatus } from "./pages/Settings/TerminalStatus";
import { AppUpdatePage } from "./pages/Settings/AppUpdatePage";
import { SetupWizard } from "./pages/Setup/SetupWizard";

function App() {
  const { isAuthenticated } = useAuthStore();
  const { t } = useTranslation();
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.app?.onCloseRequested) return;
    const unsubscribe = window.electronAPI.app.onCloseRequested(() => {
      setShowQuitConfirm(true);
    });
    return unsubscribe;
  }, []);

  return (
    <>
    {showQuitConfirm && (
      <ConfirmDialog
        title={t("common.exitApp")}
        message={t("common.exitAppConfirm")}
        confirmLabel={t("common.exit")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => window.electronAPI.app.confirmClose()}
        onCancel={() => setShowQuitConfirm(false)}
      />
    )}
    <Routes>
      {/* Setup wizard — shown in setup window on first launch */}
      <Route path="/setup" element={<SetupWizard />} />

      {/* Public routes - Login */}
      <Route
        path="/login"
        element={
          isAuthenticated ? <Navigate to="/" replace /> : <PinLoginPage />
        }
      />
      <Route
        path="/setup-pin"
        element={
          isAuthenticated ? <SetupPinPage /> : <Navigate to="/login" replace />
        }
      />

      {/* Protected routes */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        {/* Default route - POS Screen */}
        <Route index element={<POSScreen />} />


        {/* Products */}
        <Route path="products" element={<ProductList />} />
        <Route
          path="products/:id"
          element={
            <RoleGuard allowedRoles={["ADMIN", "USER"]}>
              <ProductDetails />
            </RoleGuard>
          }
        />
        <Route
          path="products/stock"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ModeGuard>
                <StockManagement />
              </ModeGuard>
            </RoleGuard>
          }
        />

        {/* Marking check — registry lookup for a single DataMatrix (all roles) */}
        <Route path="marking-check" element={<MarkingCheckPage />} />

        {/* Reports */}
        <Route path="reports/daily" element={<DailySummary />} />
        <Route
          path="reports/monthly"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <MonthlyReport />
            </RoleGuard>
          }
        />
        <Route
          path="reports/analytics"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <Analytics />
            </RoleGuard>
          }
        />

        {/* Settings */}
        <Route
          path="settings"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <SettingsPage />
            </RoleGuard>
          }
        />
        <Route path="settings/user" element={<UserSettings />} />
        <Route
          path="settings/system"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <SystemSettings />
            </RoleGuard>
          }
        />
        <Route
          path="settings/printer"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <PrinterSettings />
            </RoleGuard>
          }
        />
        <Route
          path="settings/price-tags"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <PriceTags />
            </RoleGuard>
          }
        />
        <Route
          path="settings/receipt"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ReceiptSettings />
            </RoleGuard>
          }
        />
        <Route
          path="settings/scale"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ScaleSettings />
            </RoleGuard>
          }
        />
        <Route
          path="settings/fiscal"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <FiscalSettings />
            </RoleGuard>
          }
        />
        <Route
          path="settings/sync"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <SyncSettings />
            </RoleGuard>
          }
        />
        <Route
          path="settings/terminals"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <TerminalStatus />
            </RoleGuard>
          }
        />

        {/* User Management (Admin only) */}
        <Route
          path="users"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ModeGuard>
                <UserList />
              </ModeGuard>
            </RoleGuard>
          }
        />
        <Route
          path="users/new"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ModeGuard>
                <UserForm />
              </ModeGuard>
            </RoleGuard>
          }
        />
        <Route
          path="users/:id/edit"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ModeGuard>
                <UserForm />
              </ModeGuard>
            </RoleGuard>
          }
        />

        {/* Supplier Management (Admin only) */}
        <Route
          path="suppliers"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ModeGuard>
                <SupplierList />
              </ModeGuard>
            </RoleGuard>
          }
        />
        <Route
          path="suppliers/:id"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <ModeGuard>
                <SupplierDetails />
              </ModeGuard>
            </RoleGuard>
          }
        />

        {/* Weighed Inventory (Admin only) */}
        <Route
          path="settings/weighed"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <WeighedInventoryPage />
            </RoleGuard>
          }
        />

        {/* App Update (Admin only) */}
        <Route
          path="settings/app-update"
          element={
            <RoleGuard allowedRoles={["ADMIN"]}>
              <AppUpdatePage />
            </RoleGuard>
          }
        />
      </Route>

      {/* Catch all - redirect to home */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

export default App;
