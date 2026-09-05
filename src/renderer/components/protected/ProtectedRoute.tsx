import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth-store';
import { useModeStore } from '../../store/mode-store';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, sessionRestored, restoreSession } = useAuthStore();
  const hydrateMode = useModeStore((s) => s.hydrate);
  const applyModeUpdate = useModeStore((s) => s.applyUpdate);
  const location = useLocation();
  const [isRestoring, setIsRestoring] = useState(!sessionRestored);

  useEffect(() => {
    const restore = async () => {
      await restoreSession();
      setIsRestoring(false);
    };
    restore();
  }, [restoreSession]);

  // The store's operating mode gates which admin surfaces exist. Hydrate it alongside the session
  // and keep listening, so a super admin's toggle re-gates this terminal on the next sync cycle
  // rather than at the next restart.
  useEffect(() => {
    hydrateMode();
    return window.electronAPI.config.onModeChanged(applyModeUpdate);
  }, [hydrateMode, applyModeUpdate]);

  // Show nothing while restoring session
  if (isRestoring) {
    return null;
  }

  if (!isAuthenticated) {
    // Redirect to login, preserving the intended destination
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
