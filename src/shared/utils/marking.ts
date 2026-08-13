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

/**
 * Strip the symbology prefix a scanner prepends (`]d2`, `]C1`, `]e0`) and a LEADING FNC1 byte.
 * Internal \x1d separators are preserved — asl-belgisi needs them to find the crypto group.
 */
export function normalizeDataMatrix(raw: string): string {
  return (raw || '')
    .trim()
    .replace(/^\](?:d2|C1|e0)/i, '')
    .replace(/^\x1d/, '');
}

/**
 * Reduce a scanned DataMatrix to the key asl-belgisi indexes on: AIs 01 (GTIN) + 21 (serial).
 * The trailing crypto/verification group (AI 91/92/93) is NOT part of that key — including it
 * makes /codes return an empty array, i.e. a false "not found".
 *
 * Canonical implementation, shared by the VPS proxy and the POS main process.
 */
export function stripCryptoTail(code: string): string {
  // Real scans separate the crypto group with a GS byte (\x1d); cut at the first GS.
  const gsIdx = code.indexOf('\x1d');
  if (gsIdx !== -1) return code.slice(0, gsIdx);
  // No GS (e.g. manually entered): anchor past the 01+GTIN+21 header (18 chars) and drop a
  // trailing 91/92/93 group from the serial region, leaving the serial intact. Serials may
  // legitimately contain '(' and digits, so never split the code on parentheses.
  if (code.length > 18 && /^01\d{14}21/.test(code)) {
    return code.slice(0, 18) + code.slice(18).replace(/9[123][^\x1d]*$/, '');
  }
  return code;
}

/**
 * The exact form the SALE path persists in `sold_marking_codes.code` / cart `markingCode`:
 * symbology prefix removed, then ALL internal GS bytes removed — crypto tail KEPT.
 *
 * Deliberately different from stripCryptoTail() (which produces the asl-belgisi *lookup* key).
 * Anything querying the sold/pending tables must use this form or it will silently never match.
 */
export function toSoldCodeKey(raw: string): string {
  return normalizeDataMatrix(raw).replace(/\x1d/g, '');
}

/** GTIN-14 → EAN-13 (drops the leading pad zero). Returns null when the code has no AI 01. */
export function extractGtinFromDataMatrix(raw: string): string | null {
  const m = normalizeDataMatrix(raw).match(/^01(\d{14})/);
  return m ? m[1].replace(/^0/, '') : null;
}
