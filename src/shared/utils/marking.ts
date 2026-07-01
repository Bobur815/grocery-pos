// Mandatory-marking (Asl-Belgisi DataMatrix) detection.
//
// A product in a marking MXIK group must be sold by scanning its unique QR/DataMatrix marking
// code, never a plain EAN barcode. This is a property of the PRODUCT (its own MXIK), NOT of its
// category: a category's mxik_group_code is a coverage list that can legitimately span many
// groups (e.g. a "confectionery" category holding 017/018/019/…), so keying marking off the
// category wrongly gates every product in any category that merely lists a marking group. Always
// decide from the product's own 17-digit MXIK.
//
// The mandatory-marking groups are 020 and 022 (the leading 3 digits of the MXIK).
export const MARKING_GROUP_CODES = ['020', '022'] as const;

/** True if a product's MXIK belongs to a mandatory-marking group (020 / 022 = unique-QR goods). */
export function isMarkedMxik(mxik?: string | null): boolean {
  return (
    typeof mxik === 'string' && MARKING_GROUP_CODES.some((g) => mxik.startsWith(g))
  );
}

/**
 * Whether a product must be sold by scanning its unique DataMatrix QR (mandatory marking).
 *
 * Prefers the authoritative per-product `isMarked` flag (populated from tasnif's `label`: true =
 * marked, false = plain). The group-prefix heuristic (isMarkedMxik) is wrong in both directions —
 * it forces plain goods in groups 020/022 to QR and misses marked goods in other groups — so it is
 * used ONLY as a fallback while `isMarked` is still null (not yet backfilled from tasnif).
 */
export function productRequiresMarking(product: {
  isMarked?: boolean | null;
  mxik?: string | null;
}): boolean {
  return product.isMarked ?? isMarkedMxik(product.mxik);
}
