import React from "react";
import { useTranslation } from "react-i18next";
import styled, { DefaultTheme } from "styled-components";
import type { InventoryCountStatus } from "../../api/client";

/**
 * There is no shared Badge component in this codebase — status pills are local styled
 * spans (see LowStockBadge in StockManagement). This one is shared between the stocktake
 * list and detail pages.
 */
const STATUS_STYLES: Record<
  InventoryCountStatus,
  { color: (theme: DefaultTheme) => string; labelKey: string }
> = {
  DRAFT: {
    color: (theme) => theme.colors.warning,
    labelKey: "inventoryCount.status.draft",
  },
  IN_PROGRESS: {
    color: (theme) => theme.colors.info,
    labelKey: "inventoryCount.status.inProgress",
  },
  COMPLETED: {
    color: (theme) => theme.colors.success,
    labelKey: "inventoryCount.status.completed",
  },
  CANCELLED: {
    color: (theme) => theme.colors.textSecondary,
    labelKey: "inventoryCount.status.cancelled",
  },
};

const Pill = styled.span<{ $status: InventoryCountStatus }>`
  display: inline-block;
  background-color: ${({ theme, $status }) => STATUS_STYLES[$status].color(theme)};
  color: #fff;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
`;

export function InventoryCountStatusBadge({
  status,
}: {
  status: InventoryCountStatus;
}) {
  const { t } = useTranslation();
  return <Pill $status={status}>{t(STATUS_STYLES[status].labelKey)}</Pill>;
}
