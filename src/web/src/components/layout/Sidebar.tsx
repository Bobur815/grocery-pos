import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import {
  Package,
  BarChart3,
  TrendingUp,
  LineChart,
  ClipboardList,
  ClipboardCheck,
  Settings,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Truck,
  Store,
  ScrollText,
  Image,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "../../store/auth-store";
import { useSidebar } from "@context/SidebarContext";
import { ConfirmDialog } from "@components/common/ConfirmDialog";

const SIDEBAR_WIDTH = 220;
const MINI_SIDEBAR_WIDTH = 70;

const Container = styled.aside<{ $collapsed: boolean }>`
  width: ${({ $collapsed }) =>
    $collapsed ? MINI_SIDEBAR_WIDTH : SIDEBAR_WIDTH}px;
  min-width: ${({ $collapsed }) =>
    $collapsed ? MINI_SIDEBAR_WIDTH : SIDEBAR_WIDTH}px;
  background-color: ${({ theme }) => theme.colors.surface};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  transition:
    width 0.3s ease,
    min-width 0.3s ease;
  overflow: hidden;

  @media (max-width: 767px) {
    display: none;
  }
`;

const MobileBottomNav = styled.nav`
  display: none;

  @media (max-width: 767px) {
    display: flex;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background-color: ${({ theme }) => theme.colors.surface};
    border-top: 1px solid ${({ theme }) => theme.colors.border};
    z-index: 100;
    padding: 6px 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
`;

const MobileNavItem = styled(NavLink)`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 4px;
  gap: 2px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-decoration: none;
  font-size: 11px;
  transition: color 0.2s;

  &.active {
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const MobileNavButton = styled.button`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 4px;
  gap: 2px;
  color: ${({ theme }) => theme.colors.error};
  background: none;
  border: none;
  font-size: 11px;
  cursor: pointer;
  transition: color 0.2s;
`;

const LogoSection = styled.div<{ $collapsed: boolean }>`
  padding: ${({ theme }) => theme.spacing.lg};
  padding-right: ${({ theme, $collapsed }) =>
    $collapsed ? theme.spacing.lg : theme.spacing.sm};
  display: flex;
  align-items: center;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "space-between"};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  min-height: 60px;
  position: relative;
`;

const Logo = styled.div<{ $collapsed: boolean }>`
  font-size: ${({ $collapsed }) => ($collapsed ? "16px" : "20px")};
  font-weight: bold;
  color: ${({ theme }) => theme.colors.primary};
  white-space: nowrap;
  overflow: hidden;
`;

const ToggleButton = styled.button`
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  padding: 4px;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;

  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
    color: ${({ theme }) => theme.colors.text};
  }
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

const SectionTitle = styled.div<{ $collapsed: boolean }>`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  margin-bottom: ${({ $collapsed }) => ($collapsed ? "0" : "8px")};
  padding: 0 ${({ theme }) => theme.spacing.sm};
  white-space: nowrap;
  overflow: hidden;
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-height: ${({ $collapsed }) => ($collapsed ? "0" : "20px")};
  transition:
    opacity 0.2s ease,
    max-height 0.3s ease,
    margin-bottom 0.3s ease;
`;

const StyledNavLink = styled(NavLink)<{ $collapsed: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  color: ${({ theme }) => theme.colors.text};
  text-decoration: none;
  transition: all 0.2s;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};

  &:hover {
    background-color: ${({ theme }) => theme.colors.background};
  }

  &.active {
    background-color: ${({ theme }) => theme.colors.primary}20;
    color: ${({ theme }) => theme.colors.primary};
  }
`;

const IconWrapper = styled.span`
  flex-shrink: 0;
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const NavText = styled.span<{ $collapsed: boolean }>`
  white-space: nowrap;
  overflow: hidden;
  font-size: 15px;
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-width: ${({ $collapsed }) => ($collapsed ? "0" : "180px")};
  transition:
    opacity 0.2s ease,
    max-width 0.3s ease;
`;

const Tooltip = styled.span`
  position: absolute;
  left: 100%;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 8px;
  padding: 4px 8px;
  background-color: ${({ theme }) => theme.colors.text};
  color: ${({ theme }) => theme.colors.surface};
  font-size: 12px;
  border-radius: 4px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
  z-index: 1000;
`;

const NavItemWrapper = styled.div`
  position: relative;

  &:hover ${Tooltip} {
    opacity: 1;
  }
`;

const BottomSection = styled.div<{ $collapsed: boolean }>`
  padding: ${({ theme }) => theme.spacing.md};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const UserSection = styled.div<{ $collapsed: boolean }>`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};
`;

const UserName = styled.span`
  font-weight: 500;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const UserRole = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  background-color: ${({ theme }) => theme.colors.primary}20;
  padding: 1px 6px;
  border-radius: 10px;
  white-space: nowrap;
`;

const UserDetails = styled.div<{ $collapsed: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  opacity: ${({ $collapsed }) => ($collapsed ? 0 : 1)};
  max-width: ${({ $collapsed }) => ($collapsed ? "0" : "180px")};
  transition:
    opacity 0.2s ease,
    max-width 0.3s ease;
`;

const LogoutButton = styled.button<{ $collapsed: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.sm};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: none;
  border: none;
  color: ${({ theme }) => theme.colors.error};
  cursor: pointer;
  transition: all 0.2s;
  justify-content: ${({ $collapsed }) =>
    $collapsed ? "center" : "flex-start"};

  &:hover {
    background-color: ${({ theme }) => theme.colors.error}10;
  }
`;

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const getUserName = () => {
    if (!user) return "";
    return i18n.language === "uz" ? user.nameUz : user.nameRu;
  };

  const renderNavItem = (
    to: string,
    IconComponent: LucideIcon,
    label: string,
    end?: boolean,
  ) => (
    <NavItemWrapper key={to}>
      <StyledNavLink to={to} $collapsed={isCollapsed} end={end}>
        <IconWrapper>
          <IconComponent size={18} />
        </IconWrapper>
        <NavText $collapsed={isCollapsed}>{label}</NavText>
      </StyledNavLink>
      {isCollapsed && <Tooltip>{label}</Tooltip>}
    </NavItemWrapper>
  );

  const mobileNavItems = isSuperAdmin
    ? [{ to: "/admin/stores", icon: Store }, { to: "/admin/logs", icon: ScrollText }, { to: "/admin/login-banner", icon: Image }, { to: "/admin/subscription-plans", icon: CreditCard }, { to: "/settings/user", icon: Settings }]
    : [
        { to: "/products", icon: Package },
        { to: "/products/stock", icon: ClipboardList },
        // Stocktake is an admin-only route — showing it to a cashier would just bounce them.
        ...(isAdmin
          ? [{ to: "/products/stock/inventarizatsiya", icon: ClipboardCheck }]
          : []),
        { to: "/suppliers", icon: Truck },
        { to: "/reports/daily", icon: BarChart3 },
        { to: "/settings", icon: Settings },
      ];

  return (
    <>
      {/* Desktop sidebar */}
      <Container $collapsed={isCollapsed}>
        <LogoSection $collapsed={isCollapsed}>
          <Logo $collapsed={isCollapsed}>
            {isCollapsed ? "PG" : "POSGRO"}
          </Logo>
          <ToggleButton
            onClick={toggleSidebar}
            title={isCollapsed ? t("nav.expand") : t("nav.collapse")}
          >
            {isCollapsed ? (
              <ChevronRight size={18} />
            ) : (
              <ChevronLeft size={18} />
            )}
          </ToggleButton>
        </LogoSection>

        <Nav>
          {!isSuperAdmin && (
            <>
              <NavSection>
                <SectionTitle $collapsed={isCollapsed}>
                  {t("nav.main")}
                </SectionTitle>
                {renderNavItem("/products", Package, t("nav.products"))}
              </NavSection>

              <NavSection>
                <SectionTitle $collapsed={isCollapsed}>
                  {t("nav.reports")}
                </SectionTitle>
                {renderNavItem(
                  "/reports/daily",
                  BarChart3,
                  t("nav.dailySummary"),
                )}
                {isAdmin && (
                  <>
                    {renderNavItem(
                      "/reports/monthly",
                      TrendingUp,
                      t("nav.monthlyReport"),
                    )}
                    {renderNavItem(
                      "/reports/analytics",
                      LineChart,
                      t("nav.analytics"),
                    )}
                  </>
                )}
              </NavSection>

              {isAdmin && (
                <NavSection>
                  <SectionTitle $collapsed={isCollapsed}>
                    {t("nav.inventory")}
                  </SectionTitle>
                  {/* `end` — without it NavLink would also mark Kirimlar active
                      while the nested stocktake route is open. */}
                  {renderNavItem(
                    "/products/stock",
                    ClipboardList,
                    t("nav.arrivals"),
                    true,
                  )}
                  {renderNavItem(
                    "/products/stock/inventarizatsiya",
                    ClipboardCheck,
                    t("nav.stocktake"),
                  )}
                </NavSection>
              )}

              {isAdmin && (
                <NavSection>
                  <SectionTitle $collapsed={isCollapsed}>
                    {t("nav.management")}
                  </SectionTitle>
                  {renderNavItem("/suppliers", Truck, t("suppliers.title"))}
                  {renderNavItem("/settings", Settings, t("nav.settings"))}
                </NavSection>
              )}

              {!isAdmin && (
                <NavSection>
                  <SectionTitle $collapsed={isCollapsed}>
                    {t("nav.settings")}
                  </SectionTitle>
                  {renderNavItem("/settings/user", User, t("nav.userSettings"))}
                </NavSection>
              )}
            </>
          )}

          {isSuperAdmin && (
            <NavSection>
              <SectionTitle $collapsed={isCollapsed}>Super Admin</SectionTitle>
              {renderNavItem("/admin/stores", Store, "Stores")}
              {renderNavItem("/admin/logs", ScrollText, "Logs")}
              {renderNavItem("/admin/login-banner", Image, "Login Banner")}
              {renderNavItem("/admin/subscription-plans", CreditCard, "Subscriptions")}
              {renderNavItem("/settings/user", Settings, t("nav.settings"))}
            </NavSection>
          )}
        </Nav>

        <BottomSection $collapsed={isCollapsed}>
          {user && (
            <NavItemWrapper>
              <UserSection $collapsed={isCollapsed}>
                <IconWrapper>
                  <User size={18} />
                </IconWrapper>
                <UserDetails $collapsed={isCollapsed}>
                  <UserName>{getUserName()}</UserName>
                  <UserRole>
                    {user.role === "SUPER_ADMIN"
                      ? "Super Admin"
                      : user.role === "ADMIN"
                        ? t("users.admin")
                        : t("users.cashier")}
                  </UserRole>
                </UserDetails>
              </UserSection>
              {isCollapsed && <Tooltip>{getUserName()}</Tooltip>}
            </NavItemWrapper>
          )}
          <NavItemWrapper>
            <LogoutButton $collapsed={isCollapsed} onClick={handleLogout}>
              <IconWrapper>
                <LogOut size={18} />
              </IconWrapper>
              <NavText $collapsed={isCollapsed}>{t("auth.logout")}</NavText>
            </LogoutButton>
            {isCollapsed && <Tooltip>{t("auth.logout")}</Tooltip>}
          </NavItemWrapper>
        </BottomSection>
      </Container>

      {/* Mobile bottom nav */}
      <MobileBottomNav>
        {mobileNavItems.map(({ to, icon: Icon }) => (
          <MobileNavItem key={to} to={to}>
            <Icon size={24} />
          </MobileNavItem>
        ))}
        <MobileNavButton onClick={() => setShowLogoutConfirm(true)}>
          <LogOut size={24} />
        </MobileNavButton>
      </MobileBottomNav>

      {showLogoutConfirm && (
        <ConfirmDialog
          title={t("auth.logout")}
          message={t("auth.logoutConfirm")}
          confirmLabel={t("auth.logout")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={handleLogout}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </>
  );
}
