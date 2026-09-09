import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { Menu, X, KeyRound, LogOut, User } from 'lucide-react';
import { useSidebar } from '../../context/SidebarContext';
import { useAuthStore } from '../../store/auth-store';
import { useSync } from '../../hooks/useSync';
import { POSGROIcon } from '../../branding';
import { useTheme } from '../../theme/ThemeProvider';
import { useToast } from '../../context/ToastContext';
import { SyncButton } from '../common/SyncButton';
import { useModeStore } from '../../store/mode-store';

export const APP_BAR_HEIGHT = 48;

// ─── Styled ───────────────────────────────────────────────────────────────────

const Bar = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: ${APP_BAR_HEIGHT}px;
  z-index: 200;
  background: ${({ theme }) => theme.colors.surface};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
`;

const IconBtn = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: ${({ theme }) => theme.borderRadius};
  background: none;
  color: ${({ theme }) => theme.colors.text};
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.primary};
  }

  &:active {
    transform: scale(0.9);
  }
`;

const BrandWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const BrandName = styled.span`
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
  white-space: nowrap;
  letter-spacing: 0.5px;
`;

const Spacer = styled.div`
  flex: 1;
`;

const SmenaIndicator = styled.div<{ $open: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  background: ${({ $open, theme }) =>
    $open ? theme.colors.success + '20' : theme.colors.error + '18'};
  border: 1px solid ${({ $open, theme }) =>
    $open ? theme.colors.success + '60' : theme.colors.error + '40'};
  font-size: 12px;
  font-weight: 600;
  color: ${({ $open, theme }) =>
    $open ? theme.colors.success : theme.colors.error};
  cursor: pointer;
  white-space: nowrap;
  transition: opacity 0.15s;
  &:hover { opacity: 0.8; }
`;

const Dot = styled.span<{ $open: boolean }>`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${({ $open, theme }) =>
    $open ? theme.colors.success : theme.colors.error};
  flex-shrink: 0;
`;

const Divider = styled.div`
  width: 1px;
  height: 24px;
  background: ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const UserChip = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: ${({ theme }) => theme.borderRadius};
`;

const UserName = styled.span`
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text};
  white-space: nowrap;
`;

const RoleBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.primary};
  background: ${({ theme }) => theme.colors.primary}20;
  padding: 1px 6px;
  border-radius: 10px;
  white-space: nowrap;
`;

const AppSyncBtn = styled(SyncButton)`
  width: 36px;
  height: 36px;
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.background};
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────

export function AppBar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { isCollapsed, toggleSidebar, openSmenaModal } = useSidebar();
  const { user, logout } = useAuthStore();
  const { status, refreshStatus } = useSync();
  const { mode } = useTheme();
  const toast = useToast();

  const [smenaOpen, setSmenaOpen] = useState<boolean | null>(null);

  const checkSmena = useCallback(async () => {
    if (!window.electronAPI?.smena) return;
    try {
      const s = await window.electronAPI.smena.getCurrent();
      setSmenaOpen(s != null);
    } catch {
      setSmenaOpen(null);
    }
  }, []);

  useEffect(() => {
    checkSmena();
    window.addEventListener('focus', checkSmena);
    window.addEventListener('smena-updated', checkSmena);
    return () => {
      window.removeEventListener('focus', checkSmena);
      window.removeEventListener('smena-updated', checkSmena);
    };
  }, [checkSmena]);

  // An OFFLINE_ONLY store has no server to sync with — sync-service already returns early for
  // one, so the button could only ever report success for work it never did, and then reload the
  // page for nothing. Gate on the explicit mode: null (not yet hydrated, or a terminal that was
  // never activated) keeps the button, matching mode-store's "default to permissive" rule.
  const offlineOnly = useModeStore((s) => s.mode) === 'OFFLINE_ONLY';

  const handleSync = async () => {
    const online = await window.electronAPI.app.isOnline();
    if (!online) {
      toast.error(t('errors.noInternet'));
      return;
    }
    try {
      await window.electronAPI.sync.trigger();
      await refreshStatus();
      toast.success(t('sync.syncSuccess'));
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      console.error('Sync failed:', err);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  /**
   * Hand the terminal to the next person: end this session and open the login screen already on
   * the PIN pad, so they are four taps from working. The login page defaults to the phone form
   * whenever credentials were remembered, hence saying which mode we want rather than trusting it.
   */
  const handleSwitchUser = async () => {
    await logout();
    navigate('/login', { state: { mode: 'pin' }, replace: true });
  };

  const userName = user
    ? (i18n.language === 'uz' ? user.nameUz : user.nameRu)
    : '';

  return (
    <Bar>
      {/* Hamburger / Close */}
      <IconBtn onClick={toggleSidebar} title={isCollapsed ? t('nav.expand') : t('nav.collapse')}>
        {isCollapsed ? <Menu size={20} /> : <X size={20} />}
      </IconBtn>

      {/* Brand */}
      <BrandWrapper>
        <POSGROIcon theme={mode} size={28} />
        <BrandName>POSGRO</BrandName>
      </BrandWrapper>

      <Spacer />

      {/* Smena indicator */}
      {smenaOpen !== null && (
        <SmenaIndicator $open={smenaOpen} onClick={openSmenaModal} title={t('smena.title')}>
          <Dot $open={smenaOpen} />
          {smenaOpen ? t('smena.statusOpen') : t('smena.statusClosed')}
        </SmenaIndicator>
      )}

      {/* Sync button — hidden for an OFFLINE_ONLY store, which has nothing to sync with. */}
      {!offlineOnly && (
        <AppSyncBtn
          onSync={handleSync}
          size={17}
          title={t('settings.syncNow')}
        />
      )}

      <Divider />

      {/* User section. A PIN login is shown exactly like a password login: the PIN belongs to one
          person, so the session names them just as reliably. */}
      {user && (
        <UserChip>
          <User size={15} style={{ color: 'inherit', opacity: 0.6 }} />
          <UserName>{userName}</UserName>
          <RoleBadge>
            {user.role === 'ADMIN' ? t('users.admin') : t('users.cashier')}
          </RoleBadge>
        </UserChip>
      )}
      <IconBtn onClick={handleSwitchUser} title={t('auth.switchUser')}>
        <KeyRound size={17} />
      </IconBtn>
      <IconBtn onClick={handleLogout} title={t('auth.logout')}>
        <LogOut size={17} />
      </IconBtn>
    </Bar>
  );
}
