// Mandatory-marking (Asl-Belgisi DataMatrix) detection.
//
// A product in MXIK group 022 must be sold by scanning its unique QR/DataMatrix marking code,
// never a plain EAN barcode. This is a property of the PRODUCT (its own MXIK), NOT of its
// category: a category's mxik_group_code is a coverage list that can legitimately span many
// groups (e.g. a "confectionery" category holding 017/018/019/…), so keying marking off the
// category wrongly gates every product in any category that merely lists 022. Always decide
// from the product's own 17-digit MXIK.
export const MARKING_GROUP_CODE = '022';

/** True if a product's MXIK belongs to the mandatory-marking group (022 = unique-QR goods). */
export function isMarkedMxik(mxik?: string | null): boolean {
  return typeof mxik === 'string' && mxik.startsWith(MARKING_GROUP_CODE);
}
