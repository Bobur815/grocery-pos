# Z-Hisobot (Z-Report) & Smena Reference

## Business Rules

### Smena (Shift)
- One smena per terminal at a time. Cannot open a second while one is OPEN.
- Opens with `initialCash` — the amount the cashier counted in the cash drawer.
- Z-report number (`zReportNumber`) increments per-terminal. Never resets.
- Max practical shift: 24 hours. After that, cashier should close.
- Only ADMIN or the shift's cashier can close a smena.

### X-Report (mid-shift snapshot)
- Prints current stats WITHOUT closing the smena.
- No side effects — smena stays OPEN, Z# stays the same.
- Can be printed multiple times per smena.

### Z-Report (end-of-shift)
- Printed automatically when smena is closed via `smena:close`.
- Can also be reprinted from history via `smena:printZReport`.
- Smena status → CLOSED, `closedAt` set, `finalCash` recorded.
- After Z, the Z# for that smena is frozen.

## Key Formula

```
expectedCash = initialCash + cashSalesAmount + payInTotal - payOutTotal - returnAmount
diff = finalCash - expectedCash   (positive = overage, negative = shortage)
```

`totalRevenue = cashSalesAmount + cardSalesAmount`
(Returns are NOT subtracted from totalRevenue — they appear as a separate line.)

## Database Schema

### `smenas` table
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | cuid |
| terminal_id | TEXT | from AppConfig |
| cashier_id | TEXT | User.id |
| cashier_name | TEXT | User.nameRu |
| status | TEXT | OPEN \| CLOSED |
| initial_cash | REAL | |
| final_cash | REAL? | set on close |
| z_report_number | INTEGER | per-terminal sequence |
| opened_at | DATETIME | |
| closed_at | DATETIME? | |
| synced | INTEGER | 0/1 |

### `smena_movements` table
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | cuid |
| smena_id | TEXT FK | |
| type | TEXT | PAY_IN \| PAY_OUT |
| amount | REAL | always positive |
| note | TEXT? | |
| created_at | DATETIME | |

### `sales` table addition
- `smena_id TEXT` — nullable FK to smenas.id

## Returns Tracking

Returns are NOT a first-class model. When a sale is deleted:
1. `sales:delete` handler stores `smenaId` + `finalAmount` in `audit_logs.details` JSON (written via
   raw SQL — the general AuditLog feature was removed, so `audit_logs` is now a local SQLite table
   kept solely for this delete_sale/returns tracking).
2. `computeSmenaStats()` queries:
   ```sql
   SELECT COUNT(*), SUM(json_extract(details,'$.finalAmount'))
   FROM audit_logs
   WHERE action = 'delete_sale'
     AND json_extract(details, '$.smenaId') = ?
   ```

This means returns are always tied to the smena in which the sale was originally made — not the smena in which the cashier deleted it.

## IPC Handlers

| Channel | Input | Output |
|---------|-------|--------|
| `smena:getCurrent` | — | `Smena & { stats, movements } \| null` |
| `smena:open` | `{ initialCash }` | `Smena` |
| `smena:addMovement` | `{ smenaId, type, amount, note? }` | `SmenaMovement` |
| `smena:close` | `{ smenaId, finalCash }` | `Smena & { stats }` |
| `smena:printZReport` | `smenaId` | `boolean` |
| `smena:printXReport` | `smenaId` | `boolean` |
| `smena:getHistory` | `{ limit? }` | `(Smena & { stats })[]` |

## Error Codes

| Code | Meaning |
|------|---------|
| `SMENA_ALREADY_OPEN` | Tried to open when one already exists |
| `SMENA_NOT_OPEN` | Tried to close/add movement to non-open smena |
| `NO_SMENA_OPEN` | Tried to create a sale without an open smena |

## Print Format (80mm / 42-char)

```
             MAGAZIN ADI
             Manzil
         Tel: +998xx  STIR: 123
──────────────────────────────────────────
         Z-HISOBOT / Z-ОТЧЕТ
       Z-hisobot №3  Terminal: T1
──────────────────────────────────────────
Smena ochildi:    28.04.2026 09:00
Smena yopildi:    28.04.2026 18:30
Kassir:           Bobur
──────────────────────────────────────────
Boshlang'ich naqd:       500 000 so'm
Kirim (Pay-in):          100 000 so'm
Chiqim (Pay-out):         50 000 so'm
──────────────────────────────────────────
Naqd savdo (12 chek):  1 200 000 so'm
Karta (5 chek):          450 000 so'm
Qaytarish (1 chek):       30 000 so'm
Chegirmalar:              15 000 so'm
Jami daromad:          1 650 000 so'm
──────────────────────────────────────────
Kutilayotgan naqd:     1 820 000 so'm
Haqiqiy naqd:          1 820 000 so'm
Ortiqcha / Kamomad:            0 so'm
──────────────────────────────────────────
   SMENA YOPILDI / СМЕНА ЗАКРЫТА
──────────────────────────────────────────
              28.04.2026 18:31
```

## Edge Cases

1. **Power failure during sale** — sale won't be committed to DB (SQLite transaction), stock unchanged.
2. **Sale deleted after smena closed** — `computeSmenaStats` uses `json_extract(details,'$.smenaId')` so it still counts against the original smena even if deleted days later.
3. **Multiple terminals** — each terminal has independent smena + Z# sequence. Server-side consolidation is not in scope for v1.
4. **Reprint Z after close** — `smena:printZReport` works on any closed smena from history tab.
5. **First smena** — `MAX(z_report_number)` returns NULL → `nextZ = 1`.
6. **Printer offline** — Z-report print error is caught and logged but smena still closes successfully.

## Future Enhancements (not in v1)
- Sync smenas to server (PostgreSQL) for multi-terminal consolidation.
- Cashier-level Z-reports (currently terminal-level).
- OFD (fiscal data operator) integration.
- Enforce max-shift duration (24h) with warning.
