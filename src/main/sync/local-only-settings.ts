/**
 * System-setting keys that never cross the wire in either direction.
 *
 * This list is deliberately shared by both sync directions. It used to be duplicated in
 * upload-sync.ts and products-sync.ts, and the two copies had already drifted — a key excluded
 * from upload but not from download is worse than not excluding it at all, because the server's
 * stale copy then silently overwrites the terminal's own value on the next cycle.
 */
export const LOCAL_ONLY_SETTINGS = new Set([
  // ── Sync bookkeeping: meaningful only to this terminal ──
  'server_token',
  'last_product_sync',
  'last_sale_sync',
  'last_upload_sync',
  'last_audit_log_sync',
  'ai_token_limit_daily',

  // ── Machine-scoped hardware config ──
  // Windows device names and a physical label size. They describe the box this terminal runs on,
  // not the store, so a second terminal's values must never land here. These matter more now that
  // a cashier-only store stops uploading settings entirely: without the download exclusion, one
  // terminal's printer name would propagate to every other terminal in the store.
  'printer_name',
  'label_printer_name',
  'label_width_mm',

  // ── Machine-scoped fiscal (REGOS VCR) config ──
  // The VCR is a local service: its URL must resolve to this machine (127.0.0.1, never a shared
  // hostname) and the POS id identifies this physical register to the fiscal registrar.
  'regos_vcr_url',
  'regos_vcr_pos_id',
  // Encrypted with THIS terminal's safeStorage/DPAPI key, so only this machine can decrypt it.
  // Syncing it lets another terminal's blob overwrite the local row, after which decryption
  // throws and the cashier password silently resolves to ''.
  'regos_vcr_password_enc',
]);
