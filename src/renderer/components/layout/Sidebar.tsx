import React, { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import {
  ShoppingCart,
  Package,
  TrendingUp,
  LineChart,
  ClipboardList,
  Settings,
  User,
  Truck,
  Clock,
  type LucideIcon,
  ReceiptText,
  Download,
  CheckCircle,
  ShieldCheck,
} from "lucide-react";
import { SyncButton } from "../common/SyncButton";
import { useAuthStore } from "../../store/auth-store";
import { useModeStore } from "../../store/mode-store";
import { useSidebar } from "../../context/SidebarContext";
import { useSync } from "../../hooks/useSync";
import { APP_BAR_HEIGHT } from "./AppBar";

const SIDEBAR_WIDTH = 240;

const Backdrop = styled.div<{ $visible: boolean }>`
  position: fixed;
  top: ${APP_BAR_HEIGHT}px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99;
  background: rgba(0, 0, 0, 0.4);
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  pointer-events: ${({ $visible }) => ($visible ? "auto" : "none")};
  transition: opacity 0.25s ease;
`;

// Fixed shell — always occupies left edge, out of layout flow
const Container = styled.aside`
  position: fixed;
  left: 0;
  top: ${APP_BAR_HEIGHT}px;
  height: calc(100% - ${APP_BAR_HEIGHT}px);
  width: ${SIDEBAR_WIDTH}px;
  z-index: 100;
  pointer-events: none;
  overflow: visible;
`;

// Drawer panel — slides in/out via transform
const SidebarInner = styled.div<{ $collapsed: boolean }>`
  width: ${SIDEBAR_WIDTH}px;
  height: 100%;
  background-color: ${({ theme }) => theme.colors.surface};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  transform: translateX(${({ $collapsed }) => ($collapsed ? "-100%" : "0")});
  transition: transform 0.25s ease;
  box-shadow: ${({ $collapsed }) =>
    $collapsed ? "none" : "4px 0 24px rgba(0,0,0,0.18)"};
`;


const Nav = styled.nav`
  flex: 1;
  padding: ${({ theme }) => theme.spacing.md};
  overflow-y: auto;
  overflow-x: hidden;
`;

const NavSection = styled.div`
  margin-bottom: ${({ theme }) => theme.spacing.md};
`;

const SectionTitle = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  margin-bottom: 6px;
  padding: 0 ${({ theme }) => theme.spacing.sm};
  white-space: nowrap;
  letter-spacing: 0.05em;
`;

const StyledNavLink = styled(NavLink)`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  color: ${({ theme }) => theme.colors.text};
  text-decoration: none;
  transition: all 0.2s;

  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
  }

  &.active {
    background-color: ${({ theme }) => theme.colors.primary}20;
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const NavButton = styled.button`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  color: ${({ theme }) => theme.colors.text};
  text-decoration: none;
  transition: all 0.2s;
  background: none;
  border: none;
  cursor: pointer;
  width: 100%;
  text-align: left;

  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
  }
`;

const IconWrapper = styled.span`
  flex-shrink: 0;
  width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const NavText = styled.span`
  white-space: nowrap;
  font-size: 15px;
`;

const BottomSection = styled.div`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const SyncStatus = styled.div<{ $syncing?: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
  font-size: 11px;
  color: ${({ theme, $syncing }) =>
    $syncing ? theme.colors.warning : theme.colors.success};
  padding: 0 ${({ theme }) => theme.spacing.sm};
`;

const SidebarSyncBtn = styled(SyncButton)`
  padding: 4px;
  flex-shrink: 0;
  margin-left: auto;
`;

const SyncText = styled.span`
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
`;


const UpdateDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: ${({ theme }) => theme.colors.error};
  margin-left: auto;
  flex-shrink: 0;
`;

const VersionRow = styled.div`
  padding: 0 ${({ theme }) => theme.spacing.sm};
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const UpdateBanner = styled(NavLink)<{ $downloaded?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  font-size: 12px;
  font-weight: 500;
  text-decoration: none;
  background-color: ${({ theme, $downloaded }) =>
    $downloaded ? `${theme.colors.success}22` : `${theme.colors.warning}22`};
  color: ${({ theme, $downloaded }) =>
    $downloaded ? theme.colors.success : theme.colors.warning};
  transition: opacity 0.2s;
  &:hover { opacity: 0.75; }
`;

export function Sidebar() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { isCollapsed, collapseSidebar, openSmenaModal } = useSidebar();
  const { status, refreshStatus } = useSync();
  const isAdmin = user?.role === "ADMIN";
  const posAdminLocked = useModeStore((s) => s.posAdminLocked);
  const [currentVersion, setCurrentVersion] = useState("");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateDownloaded, setUpdateDownloaded] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");

  useEffect(() => {
    window.electronAPI?.app?.getVersion().then(setCurrentVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.updater) return;
    const unsubs = [
      window.electronAPI.updater.onAvailable((info) => {
        setUpdateAvailable(true);
        setUpdateVersion(info.version);
      }),
      window.electronAPI.updater.onDownloaded((info) => {
        setUpdateDownloaded(true);
        setUpdateVersion(info.version);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const handleSyncNow = async () => {
    try {
      await window.electronAPI.sync.trigger();
      await refreshStatus();
    } catch (err) {
      console.error("Sync failed:", err);
    }
  };

  const renderNavItem = (
    to: string,
    IconComponent: LucideIcon,
    label: string,
    end?: boolean,
  ) => (
    <StyledNavLink to={to} end={end} onClick={collapseSidebar}>
      <IconWrapper>
        <IconComponent size={17} />
      </IconWrapper>
      <NavText>{label}</NavText>
    </StyledNavLink>
  );

  return (
    <>
      <Backdrop $visible={!isCollapsed} onClick={collapseSidebar} />
      <Container>
      <SidebarInner $collapsed={isCollapsed}>
        <Nav>
          <NavSection>
            <SectionTitle>{t("nav.main")}</SectionTitle>
            {renderNavItem("/", ShoppingCart, t("nav.pos"), true)}
            <NavButton onClick={() => { openSmenaModal(); collapseSidebar(); }}>
              <IconWrapper><Clock size={17} /></IconWrapper>
              <NavText>{t("nav.smena")}</NavText>
            </NavButton>
            {renderNavItem("/products", Package, t("nav.products"))}
            {renderNavItem("/marking-check", ShieldCheck, t("nav.markingCheck"))}
          </NavSection>

          <NavSection>
            <SectionTitle>{t("nav.reports")}</SectionTitle>
            {renderNavItem("/reports/daily", ReceiptText, t("nav.receipts"))}
            {isAdmin && (
              <>
                {renderNavItem("/reports/monthly", TrendingUp, t("nav.monthlyReport"))}
                {renderNavItem("/reports/analytics", LineChart, t("nav.analytics"))}
              </>
            )}
          </NavSection>

          {isAdmin && (
            <NavSection>
              <SectionTitle>{t("nav.management")}</SectionTitle>
              {/* Stock and suppliers move to the web dashboard once the store is cashier-only.
                  Settings stays: printer, scale, fiscal and sync are this machine's own config. */}
              {!posAdminLocked &&
                renderNavItem("/products/stock", ClipboardList, t("nav.inventory"))}
              {!posAdminLocked && renderNavItem("/suppliers", Truck, t("suppliers.title"))}
              <StyledNavLink to="/settings" onClick={collapseSidebar}>
                <IconWrapper><Settings size={17} /></IconWrapper>
                <NavText>{t("nav.settings")}</NavText>
                {updateAvailable && <UpdateDot />}
              </StyledNavLink>
            </NavSection>
          )}

          {!isAdmin && (
            <NavSection>
              <SectionTitle>{t("nav.settings")}</SectionTitle>
              {renderNavItem("/settings/user", User, t("nav.userSettings"))}
            </NavSection>
          )}
        </Nav>

        <BottomSection>
          <SyncStatus $syncing={status.isSyncing}>
            <span>{status.isSyncing ? "🔄" : "✓"}</span>
            <SyncText>
              {status.isSyncing
                ? t("sync.syncing")
                : status.lastSyncTime
                  ? `${t("sync.lastSync")}: ${new Date(status.lastSyncTime).toLocaleTimeString()}`
                  : t("sync.notSynced")}
            </SyncText>
            <SidebarSyncBtn
              onSync={handleSyncNow}
              size={15}
              title={t("settings.syncNow")}
            />
          </SyncStatus>

          {currentVersion && (
            updateDownloaded ? (
              <UpdateBanner $downloaded to="/settings/app-update" onClick={collapseSidebar}>
                <CheckCircle size={13} />
                v{updateVersion} — {t("updater.installAndRestart")}
              </UpdateBanner>
            ) : updateAvailable ? (
              <UpdateBanner to="/settings/app-update" onClick={collapseSidebar}>
                <Download size={13} />
                v{updateVersion} — {t("updater.updateAvailable")}
              </UpdateBanner>
            ) : (
              <VersionRow>v{currentVersion}</VersionRow>
            )
          )}
        </BottomSection>
      </SidebarInner>
    </Container>
    </>
  );
}
