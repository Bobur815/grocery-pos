# Fix: keyboard-layout corruption of scanned QR/DataMatrix marking codes

## Problem
HID barcode scanners "type" the code as US-QWERTY key positions. When Windows input
language is **Russian**, those positions render as Cyrillic, corrupting alphanumeric
DataMatrix marking codes (digits survive → plain EAN barcodes still scan). ~1000+
non-fiscalised marking codes were stored corrupted in the till's SQLite.

## Root cause
Renderer keydown handler appended `e.key` (the OS-language-mapped char) instead of the
physical key. Corruption is a deterministic RU-layout-over-US-keys substitution → reversible.

## Plan
- [x] Investigate storage: `pending_marking_codes.code`, `sold_marking_codes.code`,
      `sales.regos_labels` (JSON `[{barcode,label}]`).
- [ ] Add `src/shared/utils/keyboard-layout.ts` — single source of truth:
      `physicalKeyToChar(code, shift)` (US layout) + `repairCyrillicLayout(str)` (inverse).
- [ ] Wire `physicalKeyToChar` into POSScreen barcode keydown → layout-proof scanning.
- [ ] Keep the ASCII-reject guard as defense-in-depth.
- [ ] Recovery script `scripts/fix-corrupted-marking-codes.ts` (SQLite, dry-run default,
      `--apply`): repairs the 3 locations, validates each against `^01\d{14}21`, flags
      anything that doesn't round-trip instead of guessing.
- [ ] Add npm script + a small unit test for the layout round-trip.
- [ ] Bump app version at deploy (renderer change).

## Review

### Live fix (scanning is now layout-proof)
- `src/shared/utils/keyboard-layout.ts` — single source of truth: `physicalKeyToChar(code, shift)`
  (US-QWERTY by physical key) + `repairCyrillicLayout(str)` / `isLayoutCorrupted(str)` (exact inverse).
- `POSScreen.tsx` barcode keydown now appends the PHYSICAL key char, falling back to a printable
  `e.key` (ALT-mode/IME). Cyrillic OS layout can no longer corrupt scans. ASCII-reject guard kept
  as defense-in-depth. 7 unit tests pass.

### Bulk fiscalise old receipts (replaces auto-retry)
- Removed the 30s background retry worker (`start()` no longer sets the interval; index.ts comment
  updated). Kept: immediate fiscalise on new sale + shift-close flush.
- `regos-vcr-service.fiscalizeOldReceipts()`: 022 receipts → repair `regosLabels` (Cyrillic→ASCII),
  reset to PENDING, fiscalise one-by-one; non-022 unfiscalised → DISABLED. Stops early if VCR
  unreachable. New `repairSaleLabels()` helper.
- IPC `fiscal:fiscalizeOld` → preload `fiscal.fiscalizeOld` → button in FiscalSettings queue card,
  with ru/uz strings and a summary toast.

### Notes / follow-ups
- The "every 5s" retry was actually the **30s** worker — that's the one removed; the 5s timers
  elsewhere are sync/auto-update, untouched.
- Old DISABLED receipts predating the VCR have `regosLabels=null` → nothing to repair/fiscalise;
  if any contain a 022 product they will be attempted and likely fail (no label). Corrupted labels
  in `pending_marking_codes`/`sold_marking_codes` are NOT rewritten (unique-constraint risk) — only
  `regosLabels` is repaired, which is what fiscalisation reads.
- Version NOT bumped (renderer+main changed) — bump at deploy per project convention, then
  `npm run deploy:pos`.
