import { Router } from '../router';
import { analyticsRoutes } from './analytics';
import { authRoutes } from './auth';
import { categoryRoutes, settingsRoutes } from './catalog';
import { inventoryRoutes } from './inventory';
import { inventoryCountRoutes } from './inventory-counts';
import { invoiceRoutes, logRoutes, markingRoutes, mxikRoutes, siteConfigRoutes, storeRoutes } from './misc';
import { productRoutes } from './products';
import { reconciliationRoutes } from './reconciliation';
import { salesRoutes } from './sales';
import { supplierRoutes } from './suppliers';
import { userRoutes } from './users';

/**
 * The local API, assembled.
 *
 * Order matters within a domain — a literal segment must be registered before the `:id` pattern
 * that would otherwise swallow it (`/suppliers/transactions` before `/suppliers/:id`) — but not
 * between domains, since their prefixes do not overlap.
 */
export function buildRouter(): Router {
  return new Router().add([
    ...authRoutes,
    ...productRoutes,
    ...categoryRoutes,
    ...salesRoutes,
    ...userRoutes,
    ...settingsRoutes,
    ...inventoryRoutes,
    ...inventoryCountRoutes,
    ...supplierRoutes,
    ...analyticsRoutes,
    ...reconciliationRoutes,
    ...storeRoutes,
    ...siteConfigRoutes,
    ...invoiceRoutes,
    ...mxikRoutes,
    ...markingRoutes,
    ...logRoutes,
  ]);
}
