import React from 'react';
import { Navigate } from 'react-router-dom';
import { useModeStore } from '../../store/mode-store';

interface ModeGuardProps {
  children: React.ReactNode;
}

/**
 * Blocks a route that belongs to the web admin dashboard once a store is locked to cashier-only
 * operation. Mirrors RoleGuard: a silent redirect home, no "forbidden" page.
 *
 * Unlocked is the default, so a terminal that never learned its mode keeps every route it has
 * today. Route-level gating alone is not enough for surfaces opened as modals — those hide their
 * trigger buttons instead.
 */
export function ModeGuard({ children }: ModeGuardProps) {
  const posAdminLocked = useModeStore((s) => s.posAdminLocked);

  if (posAdminLocked) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
