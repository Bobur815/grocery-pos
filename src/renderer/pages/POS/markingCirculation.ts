// Helpers for asl-belgisi marking-code status display.
//
// The pre-payment circulation guard was removed: out-of-circulation / unknown marking codes are
// now allowed into the cart, and REGOS:VCR remains the authoritative gate at fiscalization. Only
// the status localization helper is kept, used by the Fiscal Settings "fiscalise old receipts" UI.

/**
 * Localize an asl-belgisi circulation status enum (WITHDRAWN, SOLD, NOT_FOUND, …) via the
 * `pos.markingStatus.*` keys, falling back to the raw value when a status is not mapped.
 */
export function translateMarkingStatus(
  status: string | undefined,
  t: (key: string) => string,
): string {
  if (!status) return "—";
  const key = `pos.markingStatus.${status.toUpperCase()}`;
  const translated = t(key);
  return translated === key ? status : translated; // i18next returns the key when missing
}
