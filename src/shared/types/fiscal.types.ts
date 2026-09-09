// REGOS:VCR fiscalization — shared types (renderer ↔ main process)

export type FiscalState = "PENDING" | "FISCALIZED" | "FAILED" | "DISABLED";

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
  // ── UzQR (REGOS Payment.* over the same VCR connection) ──────────────────────
  // When false (default) the `uzqr` tender stays a plain label: the sale books as a cashless
  // card and the cashier takes payment out-of-band. When true, choosing UzQR drives
  // Payment.Create → on-screen QR → poll → Receipt.Sale with the resulting payment_id.
  uzqrEnabled: boolean;
  /** How often to ask VCR whether the buyer has paid. */
  uzqrPollMs: number;
  /** How long to wait for the buyer before giving up and offering a retry. */
  uzqrTimeoutMs: number;
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
  uzqrEnabled?: boolean;
  uzqrPollMs?: number;
  uzqrTimeoutMs?: number;
}

// ── UzQR ──────────────────────────────────────────────────────────────────────

/** Result of creating the QR invoice. The buyer has NOT paid yet at this point. */
export type UzQrStartResult =
  | {
      ok: true;
      /** VCR's local payment uuid — later becomes the sale's regosPaymentId. */
      vcrPaymentId: string;
      /** Raw string encoded in the QR; kept for support/debugging. */
      qrText: string;
      /** PNG data-URL rendered in main, ready for an <img src>. */
      qrDataUrl: string;
      /** Shown under the QR so a cashier can quote it to support. */
      invoiceId: string | null;
      status: number;
    }
  | { ok: false; error: string };

/** How the wait ended. Only PAID may produce a sale. */
export type UzQrState = 'PAID' | 'TIMEOUT' | 'CANCELLED';

export type UzQrFinalResult =
  | { ok: true; state: 'PAID'; vcrPaymentId: string; rrn: string | null }
  | { ok: false; state: Exclude<UzQrState, 'PAID'>; error?: string };

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

/** One position exactly as it is sent to REGOS:VCR (money in tiyin, qty ×1000). */
export interface FiscalPreviewPosition {
  name: string;
  barcode: string;
  icps: string; // MXIK (= product.mxik)
  amount: number; // tiyin (sum × 100)
  quantity: number; // qty × 1000
  vat_value: number; // tiyin; -1 = "Без НДС" (non-VAT-payer sentinel)
  discount: number; // tiyin
  package_code?: string;
  label?: string; // mandatory-marking DataMatrix code (marked goods)
  unit_name?: string;
  group_name?: string;
  owner_type?: string;
}

export interface FiscalPreviewPayment {
  type: 1 | 2; // 1 = cash, 2 = card
  value: number; // tiyin
  card_type?: number;
}

/**
 * Full illustration of a receipt for the Receipt Details modal — the stored receipt +
 * fiscal metadata, the captured marking labels, and the EXACT Receipt.Sale JSON-RPC body
 * that is (or would be) sent to REGOS:VCR. Read-only; reconstructed from current product
 * data, so for an already-fiscalised sale it reflects what a re-send would look like.
 */
export interface FiscalSalePreview {
  saleId: string;
  receiptNumber: string;
  createdAt: string;
  cashierName: string;
  terminalId: string;
  paymentMethod: string;
  totalAmount: number; // sum
  discountAmount: number; // sum
  finalAmount: number; // sum
  // Stored REGOS:VCR fiscal result / status
  fiscalStatus: string | null; // PENDING | FISCALIZED | FAILED | DISABLED
  fiscalError: string | null;
  fiscalAttempts: number | null;
  regosReceiptNo: string | null;
  regosReceiptId: string | null;
  regosFiscalSign: string | null;
  regosQrCodeUrl: string | null;
  regosTerminalId: string | null;
  regosFiscalAt: string | null;
  refunded: boolean;
  // Marking (Asl-Belgisi) DataMatrix codes captured for this receipt, by line barcode
  labels: FiscalLabel[];
  // Config context that shapes the payload
  config: {
    enabled: boolean;
    url: string;
    login: string;
    posId: string;
    nonVatPayer: boolean;
    vatPercent: number;
  };
  // The exact JSON-RPC Receipt.Sale request body sent to REGOS:VCR
  request: {
    method: "Receipt.Sale";
    code: string; // idempotency key (= sale id)
    pos_id: string;
    session_code: string | null;
    cashier_name: string;
    positions: FiscalPreviewPosition[];
    payments: FiscalPreviewPayment[];
  };
}

/**
 * Result of the "fiscalise all old receipts" bulk action. Only receipts containing a
 * group-022 marked product are fiscalised (their marking labels are repaired first, in case
 * they were captured under a Cyrillic keyboard layout); non-022 unfiscalised receipts are
 * marked DISABLED so they leave the queue.
 */
export interface FiscalBulkResult {
  enabled: boolean;
  fiscalized: number; // 022 receipts successfully fiscalised
  failed: number; // 022 receipts that still failed (e.g. missing/invalid label, VCR error)
  repaired: number; // marking labels corrected from a corrupted (Cyrillic) capture
  disabled: number; // non-022 receipts moved out of the queue
  outOfCirculation: number; // 022 receipts disabled because a marking code is out of circulation (asl-belgisi)
  unreachable?: boolean; // true if the VCR was unreachable and the run stopped early
  error?: string;
}

/**
 * Live progress for the "fiscalise all old receipts" run, streamed to the renderer over the
 * `fiscal:bulkProgress` channel so the admin can watch each receipt being checked/fiscalised.
 */
export interface FiscalBulkProgress {
  phase: "checking" | "fiscalizing" | "disabled" | "done";
  processed: number; // marked receipts handled so far
  total: number; // total marked receipts to process
  fiscalized: number;
  failed: number;
  disabled: number; // non-022 receipts disabled up front
  outOfCirculation: number; // 022 receipts disabled for a dead marking code
  currentReceipt?: string; // receiptNumber currently being processed
  lastDisabled?: { receipt: string; status: string }; // last out-of-circulation hit, for the list
}

/**
 * Timing stats for one measured step, aggregated over this app session. Keys are namespaced by
 * their source: `vcr:<Method>` is one JSON-RPC round-trip to the device, `phase:<name>` is one
 * segment of the fiscalization pipeline, `phase:TOTAL` the whole successful thing.
 */
export interface FiscalPhaseStats {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
}

/** One receipt's fiscalization, broken down into the phases it spent its time in. */
export interface FiscalSaleTiming {
  at: string;
  receiptNumber: string;
  totalMs: number;
  ok: boolean;
  phases: Array<{ name: string; ms: number }>;
}

/**
 * What `fiscal:getTimings` returns. In-memory and reset on app restart — this is a diagnostic for
 * "why is fiscalization slow right now", not a historical metrics store.
 */
export interface FiscalTimings {
  phases: Record<string, FiscalPhaseStats>;
  recent: FiscalSaleTiming[];
}
