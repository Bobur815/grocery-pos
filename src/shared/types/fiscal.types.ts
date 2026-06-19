// REGOS:VCR fiscalization — shared types (renderer ↔ main process)

export type FiscalState = 'PENDING' | 'FISCALIZED' | 'FAILED' | 'DISABLED';

/** Fiscal config exposed to the renderer. The password is NEVER sent back — only `hasPassword`. */
export interface RegosVcrConfig {
  enabled: boolean;
  url: string; // e.g. http://localhost:8080
  login: string; // always "cassir" / "kassa"
  hasPassword: boolean;
  vatPercent: number; // store-level VAT rate, 0 or 12
  // When true, the store is NOT a VAT payer: every position is sent as "Без НДС"
  // (vat_value=-1, the REGOS sentinel) instead of any rate. This is DISTINCT from a 0%
  // rate (0% is reserved for льготники; sending vat_value=0 as a non-payer is rejected
  // with 701003 "Ставка НДС запрещена"). When on, vatPercent / per-product vatRate are ignored.
  nonVatPayer: boolean;
  posId: string;
  // When true, REGOS:VCR prints the fiscal receipt itself — posgro suppresses its own
  // receipt auto-print to avoid a duplicate (Option B in REGOS_VCR_INTEGRATION.md).
  vcrPrintsReceipt: boolean;
  // When true (default), scanning a group-022 marking code checks SoldMarkingCode
  // (local + server) to block reselling an already-sold unique DataMatrix QR.
  markingCodeCheck: boolean;
}

/** Payload to update config; `password` only set when the user types a new one. */
export interface RegosVcrConfigInput {
  enabled?: boolean;
  url?: string;
  login?: string;
  password?: string;
  vatPercent?: number;
  nonVatPayer?: boolean;
  posId?: string;
  vcrPrintsReceipt?: boolean;
  markingCodeCheck?: boolean;
}

export interface FiscalConnectionResult {
  ok: boolean;
  terminalId?: string;
  appletVersion?: string;
  availableZReports?: number;
  availableUnsentReceipts?: number;
  error?: string;
}

export interface FiscalQueueStatus {
  enabled: boolean;
  pending: number;
  failed: number;
  fiscalized: number;
}

/** A scanned mandatory-marking (Asl-Belgisi DataMatrix) code tied to a cart line by barcode. */
export interface FiscalLabel {
  barcode: string;
  label: string;
}

/** Fiscal Z-report (shift) info from the VCR — amounts already converted to sum. */
export interface FiscalZReport {
  terminalId: string;
  number: number;
  openTime: string;
  closeTime: string;
  totalSaleCount: number;
  totalSaleCash: number;
  totalSaleCard: number;
  totalSaleVat: number;
  totalRefundCount: number;
  totalRefundCash: number;
  totalRefundCard: number;
}

export interface FiscalZReportStatus {
  enabled: boolean;
  open: boolean;
  info?: FiscalZReport | null;
  error?: string;
}

export interface FiscalActionResult {
  ok: boolean;
  error?: string;
}
