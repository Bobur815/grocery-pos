/**
 * Turn a sale IPC failure into a message for the cashier.
 *
 * The main process throws structured errors as a JSON string (see sales-handlers.ts), and Electron
 * wraps that in its own text: `Error invoking remote method '...': Error: {json}`. So the payload
 * is dug out from the first `{` rather than parsed directly.
 *
 * Shared by POSScreen (quick pay) and Checkout, which used to carry identical private copies —
 * meaning a new error code had to be added twice and was silently untranslated in whichever one
 * was missed.
 */
export function parseSaleError(
  err: unknown,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const message = err instanceof Error ? err.message : String(err);
  const jsonStart = message.indexOf("{");
  const jsonStr = jsonStart !== -1 ? message.slice(jsonStart) : "";
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed.code === "PRODUCT_NOT_FOUND") {
      return t("errors.productNotFound", { id: parsed.productId });
    }
    if (parsed.code === "PRODUCT_INACTIVE") {
      return t("errors.productInactive", { name: parsed.name });
    }
    if (parsed.code === "INSUFFICIENT_STOCK") {
      return t("errors.insufficientStock", {
        name: parsed.name,
        available: parsed.available,
        requested: parsed.requested,
      });
    }
    if (parsed.code === "NO_SMENA_OPEN") {
      return t("smena.noOpenSmena");
    }
    // Editing a receipt the fiscal system already owns — the cashier needs to refund and re-ring,
    // so say that rather than leaking the raw guard.
    if (parsed.code === "SALE_ALREADY_FISCALIZED") {
      return t("errors.saleAlreadyFiscalized");
    }
    if (parsed.code === "SALE_HAS_PAYMENT") {
      return t("errors.saleHasPayment");
    }
  } catch {
    // not JSON, fall through
  }
  return message || t("common.error");
}
