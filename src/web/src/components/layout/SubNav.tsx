import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import styled from "styled-components";
import { useAuthStore } from "../../store/auth-store";

/**
 * In-page tabs for a section's sub-pages.
 *
 * The mobile bottom bar tops out at five items before the icons stop being tappable, and the app
 * has ten destinations. Rather than hide half of them behind a drawer, the five bars are the
 * *sections* — Products, Stock, Suppliers, Reports, Settings — and each section's sub-pages live
 * as tabs at the top of its own pages. Nothing is buried, and every screen stays two taps away.
 *
 * The tab strip renders at every width on purpose. The desktop sidebar still lists the sub-pages,
 * but showing the group here too is what makes the hierarchy legible — you can see which siblings
 * a page has without going back to the nav.
 *
 * A section with only one visible tab renders nothing: a lone tab is decoration, not navigation.
 */

const Strip = styled.nav<{ $hideOnMobile?: boolean }>`
  display: flex;

  /*
   * A group can hide its tabs on phones. Reports does: on a phone the section is Analytics alone,
   * so a strip offering the daily and monthly reports would advertise pages the bottom bar no
   * longer leads to. 767px matches MobileBottomNav's breakpoint exactly, so the bar and the tabs
   * never disagree about which layout is showing.
   */
  ${({ $hideOnMobile }) =>
    $hideOnMobile &&
    `
    @media (max-width: 767px) {
      display: none;
    }
  `}
  gap: ${({ theme }) => theme.spacing.xs};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  overflow-x: auto;
  /* The strip scrolls rather than wraps, so a long group never pushes the page content down. */
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
`;

const Tab = styled(NavLink)`
  flex-shrink: 0;
  padding: ${({ theme }) => theme.spacing.sm} ${({ theme }) => theme.spacing.md};
  border-radius: 999px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textSecondary};
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.15s ease;

  &:hover {
    color: ${({ theme }) => theme.colors.primary};
    border-color: ${({ theme }) => theme.colors.primary};
  }

  &.active {
    background: ${({ theme }) => theme.colors.primary};
    border-color: ${({ theme }) => theme.colors.primary};
    color: #fff;
  }
`;

export interface SubNavItem {
  to: string;
  label: string;
}

/**
 * Reports keeps all three pages on desktop but shows only Analytics on a phone — the daily and
 * monthly figures are dense tables that belong on a real screen, and the bottom bar's Reports tab
 * goes straight to Analytics for anyone who can see it.
 */
export const REPORTS_HIDE_TABS_ON_MOBILE = true;

export function SubNav({
  items,
  hideOnMobile,
}: {
  items: SubNavItem[];
  hideOnMobile?: boolean;
}) {
  if (items.length < 2) return null;
  return (
    <Strip $hideOnMobile={hideOnMobile}>
      {items.map(({ to, label }) => (
        // `end` so a parent path does not stay highlighted while a child route is open.
        <Tab key={to} to={to} end>
          {label}
        </Tab>
      ))}
    </Strip>
  );
}

/**
 * The Stock section's tabs. Stocktake and reconciliation are admin-only routes, so a cashier is
 * not shown tabs that would bounce them straight back.
 */
export function useStockSubNav(): SubNavItem[] {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN");

  return [
    { to: "/products/stock", label: t("nav.arrivals") },
    ...(isAdmin
      ? [
          { to: "/products/stock/inventarizatsiya", label: t("nav.stocktake") },
          { to: "/products/stock/reconciliation", label: t("nav.reconciliation") },
        ]
      : []),
  ];
}

/**
 * The Reports section's tabs — desktop only; see `REPORTS_HIDE_TABS_ON_MOBILE`.
 *
 * Monthly and analytics are admin-only.
 */
export function useReportsSubNav(): SubNavItem[] {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN");

  return [
    { to: "/reports/daily", label: t("nav.dailySummary") },
    ...(isAdmin
      ? [
          { to: "/reports/monthly", label: t("nav.monthlyReport") },
          { to: "/reports/analytics", label: t("nav.analytics") },
        ]
      : []),
  ];
}
