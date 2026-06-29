import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from './store/auth-store';
import { Layout } from './components/layout/Layout';
import { LoginPage } from './pages/Login/LoginPage';
import { ProductList } from './pages/Products/ProductList';
import { ProductDetails } from './pages/Products/ProductDetails';
import { StockManagement } from './pages/Products/StockManagement';
import { SupplierList } from './pages/Suppliers/SupplierList';
import { SupplierDetails } from './pages/Suppliers/SupplierDetails';
import { DailySummary } from './pages/Reports/DailySummary';
import { MonthlyReport } from './pages/Reports/MonthlyReport';
import { Analytics } from './pages/Reports/Analytics';
import { UserList } from './pages/Users/UserList';
import { UserForm } from './pages/Users/UserForm';
import { SettingsPage } from './pages/Settings/SettingsPage';
import { SystemSettings } from './pages/Settings/SystemSettings';
import { UserSettings } from './pages/Settings/UserSettings';
import { DevicesPage } from './pages/Settings/DevicesPage';
import { StoreList } from './pages/Admin/StoreList';
import { LogsPage } from './pages/Admin/LogsPage';
import { LoginBannerPage } from './pages/Admin/LoginBannerPage';
import { SubscriptionPlansPage } from './pages/Admin/SubscriptionPlansPage';

function PrivateRoute({
  children,
  adminOnly = false,
  superAdminOnly = false,
  excludeSuperAdmin = false,
}: {
  children: React.ReactNode;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
  excludeSuperAdmin?: boolean;
}) {
  const { isAuthenticated, user, sessionRestored } = useAuthStore();

  if (!sessionRestored) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (superAdminOnly && user?.role !== 'SUPER_ADMIN') return <Navigate to="/" replace />;
  if (adminOnly && user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') return <Navigate to="/" replace />;
  if (excludeSuperAdmin && user?.role === 'SUPER_ADMIN') return <Navigate to="/admin/stores" replace />;

  return <>{children}</>;
}

function IndexRedirect() {
  const { user } = useAuthStore();
  return <Navigate to={user?.role === 'SUPER_ADMIN' ? '/admin/stores' : '/products'} replace />;
}

export function App() {
  const { restoreSession } = useAuthStore();
  const { i18n } = useTranslation();

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const basename = '/web';

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<IndexRedirect />} />

          {/* Products (not for super admin) */}
          <Route path="products" element={<PrivateRoute excludeSuperAdmin><ProductList /></PrivateRoute>} />
          <Route path="products/stock" element={<PrivateRoute excludeSuperAdmin><StockManagement /></PrivateRoute>} />
          <Route path="products/:id" element={<PrivateRoute excludeSuperAdmin><ProductDetails /></PrivateRoute>} />

          {/* Suppliers (not for super admin) */}
          <Route path="suppliers" element={<PrivateRoute excludeSuperAdmin><SupplierList /></PrivateRoute>} />
          <Route path="suppliers/:id" element={<PrivateRoute excludeSuperAdmin><SupplierDetails /></PrivateRoute>} />
          <Route path="suppliers/new" element={<Navigate to="/suppliers" replace />} />
          <Route path="suppliers/:id/edit" element={<Navigate to="/suppliers" replace />} />

          {/* Reports (not for super admin) */}
          <Route path="reports/daily" element={<PrivateRoute excludeSuperAdmin><DailySummary /></PrivateRoute>} />
          <Route path="reports/monthly" element={<PrivateRoute excludeSuperAdmin adminOnly><MonthlyReport /></PrivateRoute>} />
          <Route path="reports/analytics" element={<PrivateRoute excludeSuperAdmin adminOnly><Analytics /></PrivateRoute>} />

          {/* Users (admin only, not for super admin) */}
          <Route path="users" element={<PrivateRoute adminOnly excludeSuperAdmin><UserList /></PrivateRoute>} />
          <Route path="users/new" element={<PrivateRoute adminOnly excludeSuperAdmin><UserForm /></PrivateRoute>} />
          <Route path="users/:id/edit" element={<PrivateRoute adminOnly excludeSuperAdmin><UserForm /></PrivateRoute>} />

          {/* Settings */}
          <Route path="settings" element={<PrivateRoute adminOnly><SettingsPage /></PrivateRoute>} />
          <Route path="settings/system" element={<PrivateRoute adminOnly><SystemSettings /></PrivateRoute>} />
          <Route path="settings/user" element={<UserSettings />} />
          <Route path="settings/devices" element={<DevicesPage />} />

          {/* Super Admin */}
          <Route path="admin/stores" element={<PrivateRoute superAdminOnly><StoreList /></PrivateRoute>} />
          <Route path="admin/logs" element={<PrivateRoute superAdminOnly><LogsPage /></PrivateRoute>} />
          <Route path="admin/login-banner" element={<PrivateRoute superAdminOnly><LoginBannerPage /></PrivateRoute>} />
          <Route path="admin/subscription-plans" element={<PrivateRoute superAdminOnly><SubscriptionPlansPage /></PrivateRoute>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
