# POSGRO — Inventarizatsiya (Stocktake) Implementation Guide

> **Scope:** Web/admin interface only. This feature must NOT appear on the Electron POS cashier terminals.
> **Audience:** Claude Code, executing step by step in the POSGRO monorepo.
> **Terminology:** `Kirimlar` = goods arrivals/receipts (existing `/products/stock` page, `InventoryArrival` model). `Inventarizatsiya` = physical stock count + reconciliation (this feature, new models).

---

## 0. Discover existing conventions FIRST (do not skip)

Before writing anything, inspect the repo so new code matches existing patterns:

1. Open the current `/products/stock` page and its route registration. Note the router library (React Router? file-based?), how routes are declared, and how the page is styled (styled-components).
2. Open the sidebar/navigation component. Note how nav items are configured and whether any **multi-level (parent → children)** item already exists. If none does, you will introduce the pattern.
3. Note how existing NestJS modules are structured (module/controller/service/dto), how the `JwtAuthGuard` + `RolesGuard` + `@Roles(UserRole.ADMIN)` decorators are applied, and how `PrismaService` is injected.
4. Note the i18n setup (`ru.json` / `uz.json`) and the namespace convention.
5. Confirm the shape of the `Product` model (`id: Int`, `stock: Decimal`, `cost: Decimal?`, `barcode`, `unit`, `nameRu`, `nameUz`).

Match whatever conventions you find. The code below is reference, not literal — adapt import paths, guard names, and styling to the actual repo.

---

## 1. Best practices baked into this design

These are the rules the implementation follows. Keep them; they prevent the classic stocktake bugs.

- **Document-based, not a single button.** A count is a _document_ (session) with a lifecycle, so it can be started, paused, resumed, and audited — exactly like the reference screenshot (opened time, closed time, employee, status).
- **Snapshot expected quantity at creation.** When the document is created, copy each product's _current_ system stock into the count line as `expectedQty`. You reconcile physical count against what the system believed **at count time**, never against live stock.
- **`countedQty` is nullable.** `null` = "not yet counted". This is different from `0` = "counted, found nothing". Uncounted lines are skipped on completion — never silently zeroed.
- **Absolute set on completion.** Completing sets `product.stock = countedQty` for counted lines (physical reality wins). Record `difference = countedQty - expectedQty` for shrinkage/surplus reporting.
- **Immutable after completion.** A `COMPLETED` document cannot be edited. Corrections require a new count.
- **Blind-count toggle.** Optionally hide `expectedQty` while counting so the counter isn't biased toward the system number. Default: visible.
- **Barcode-driven entry.** Scanning a barcode focuses/increments that line — the primary input method for a grocery.
- **Everything transactional + audited.** Stock updates + status change happen in one `$transaction`, plus an `AuditLog` entry.
- **No fiscal side effect.** A stocktake is internal reconciliation — it does **not** emit an OFD/REGOS fiscal receipt. (Write-offs of shrinkage may later need separate tax handling; out of scope here.)

---

## 2. Database — Prisma schema

Add to `prisma/schema.prisma`.

```prisma
enum InventoryCountStatus {
  DRAFT        // Yangi / Новый
  IN_PROGRESS  // Jarayonda / В процессе
  COMPLETED    // Tasdiqlandi / Подтверждён
  CANCELLED    // Bekor qilindi / Отменён
}

enum InventoryCountScope {
  FULL      // count everything
  CATEGORY  // one category
  CUSTOM    // a hand-picked list
}

model InventoryCount {
  id     String @id @default(cuid())
  number Int    @unique @default(autoincrement()) // human-readable doc №

  status InventoryCountStatus @default(DRAFT)
  scope  InventoryCountScope  @default(FULL)

  categoryId Int? @map("category_id") // set when scope = CATEGORY

  note String? @db.Text

  createdById   String  @map("created_by_id")
  createdByName String  @map("created_by_name") // denormalized for the list

  completedById String?   @map("completed_by_id")
  completedAt   DateTime? @map("completed_at")

  // summary, filled on completion
  totalItems      Int     @default(0) @map("total_items")
  countedItems    Int     @default(0) @map("counted_items")
  totalDifference Decimal @default(0) @map("total_difference") @db.Decimal(14, 3)
  totalValueDiff  Decimal @default(0) @map("total_value_diff") @db.Decimal(14, 2)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  items InventoryCountItem[]

  @@index([status])
  @@index([createdAt])
  @@map("inventory_counts")
}

model InventoryCountItem {
  id      String         @id @default(cuid())
  countId String         @map("count_id")
  count   InventoryCount @relation(fields: [countId], references: [id], onDelete: Cascade)

  productId Int     @map("product_id")
  product   Product @relation(fields: [productId], references: [id])

  // snapshot taken at document creation
  productName String
  barcode     String
  unit        String
  expectedQty Decimal  @map("expected_qty") @db.Decimal(10, 3)
  cost        Decimal? @db.Decimal(10, 2)

  countedQty Decimal? @map("counted_qty") @db.Decimal(10, 3) // null = not counted
  difference Decimal? @db.Decimal(10, 3)                     // counted - expected
  counted    Boolean  @default(false)

  @@unique([countId, productId])
  @@index([countId])
  @@map("inventory_count_items")
}
```

Add the back-relation on the existing `Product` model:

```prisma
model Product {
  // ...existing fields...
  inventoryCountItems InventoryCountItem[]
}
```

Then migrate:

```bash
npx prisma migrate dev --name add_inventory_count
npx prisma generate
```

> ⚠️ Production DB has real data — do NOT reset the volume. Use `migrate deploy` on the VPS, never `migrate reset`.

---

## 3. Backend — NestJS `inventory-count` module

Create `src/server/modules/inventory-count/` with the standard layout.

### 3.1 DTOs

```typescript
// dto/create-inventory-count.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, IsArray } from "class-validator";
import { InventoryCountScope } from "@prisma/client";

export class CreateInventoryCountDto {
  @IsOptional()
  @IsEnum(InventoryCountScope)
  scope?: InventoryCountScope; // default FULL

  @IsOptional()
  @IsInt()
  categoryId?: number; // required when scope = CATEGORY

  @IsOptional()
  @IsArray()
  productIds?: number[]; // required when scope = CUSTOM

  @IsOptional()
  @IsString()
  note?: string;
}

// dto/update-count-item.dto.ts
import { IsNumber, Min } from "class-validator";
export class UpdateCountItemDto {
  @IsNumber()
  @Min(0)
  countedQty: number;
}

// dto/list-inventory-count.dto.ts
import { IsOptional, IsString, IsEnum, IsInt } from "class-validator";
import { InventoryCountStatus } from "@prisma/client";
export class ListInventoryCountDto {
  @IsOptional() @IsString() search?: string; // matches № or note
  @IsOptional() @IsEnum(InventoryCountStatus) status?: InventoryCountStatus;
  @IsOptional() @IsInt() page?: number; // default 1
  @IsOptional() @IsInt() limit?: number; // default 20
}
```

### 3.2 Service

```typescript
// inventory-count.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, InventoryCountStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateInventoryCountDto } from "./dto/create-inventory-count.dto";
import { ListInventoryCountDto } from "./dto/list-inventory-count.dto";

type AuthUser = { id: string; nameRu: string };

@Injectable()
export class InventoryCountService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateInventoryCountDto, user: AuthUser) {
    const scope = dto.scope ?? "FULL";

    const where: Prisma.ProductWhereInput = { active: true };
    if (scope === "CATEGORY") {
      if (!dto.categoryId)
        throw new BadRequestException("categoryId required for CATEGORY scope");
      where.categoryId = dto.categoryId;
    }
    if (scope === "CUSTOM") {
      if (!dto.productIds?.length)
        throw new BadRequestException("productIds required for CUSTOM scope");
      where.id = { in: dto.productIds };
    }

    const products = await this.prisma.product.findMany({ where });
    if (products.length === 0)
      throw new BadRequestException("No products in scope");

    return this.prisma.inventoryCount.create({
      data: {
        status: "DRAFT",
        scope,
        categoryId: scope === "CATEGORY" ? dto.categoryId : null,
        note: dto.note,
        createdById: user.id,
        createdByName: user.nameRu,
        totalItems: products.length,
        items: {
          create: products.map((p) => ({
            productId: p.id,
            productName: p.nameRu,
            barcode: p.barcode,
            unit: p.unit,
            expectedQty: p.stock, // <-- snapshot
            cost: p.cost ?? null,
          })),
        },
      },
    });
  }

  async findAll(q: ListInventoryCountDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Prisma.InventoryCountWhereInput = {};
    if (q.status) where.status = q.status;
    if (q.search) {
      const asNumber = Number(q.search);
      where.OR = [
        { note: { contains: q.search, mode: "insensitive" } },
        ...(Number.isInteger(asNumber) ? [{ number: asNumber }] : []),
      ];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryCount.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          number: true,
          status: true,
          scope: true,
          note: true,
          createdByName: true,
          createdAt: true,
          completedAt: true,
          totalItems: true,
          countedItems: true,
          totalDifference: true,
          totalValueDiff: true,
        },
      }),
      this.prisma.inventoryCount.count({ where }),
    ]);

    return { rows, total, page, limit };
  }

  async findOne(id: string) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: { items: { orderBy: { productName: "asc" } } },
    });
    if (!count) throw new NotFoundException("Count not found");
    return count;
  }

  /** Enter/adjust a physical count for one line. */
  async setItemCount(countId: string, itemId: string, countedQty: number) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id: countId },
    });
    if (!count) throw new NotFoundException("Count not found");
    if (count.status === "COMPLETED" || count.status === "CANCELLED")
      throw new BadRequestException("Count is closed");

    const updates: Prisma.PrismaPromise<any>[] = [
      this.prisma.inventoryCountItem.update({
        where: { id: itemId },
        data: { countedQty, counted: true },
      }),
    ];
    if (count.status === "DRAFT") {
      updates.push(
        this.prisma.inventoryCount.update({
          where: { id: countId },
          data: { status: "IN_PROGRESS" },
        }),
      );
    }
    await this.prisma.$transaction(updates);
    return this.findOne(countId);
  }

  /** Scan flow: barcode -> +1 to that line (or set qty). */
  async scan(countId: string, barcode: string, qty = 1) {
    const item = await this.prisma.inventoryCountItem.findFirst({
      where: { countId, barcode },
    });
    if (!item) throw new NotFoundException("Product not in this count");
    const next = (item.countedQty ? Number(item.countedQty) : 0) + qty;
    return this.setItemCount(countId, item.id, next);
  }

  /** Finalize: apply stock, compute summary, lock the document. */
  async complete(id: string, user: AuthUser) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!count) throw new NotFoundException("Count not found");
    if (count.status !== "DRAFT" && count.status !== "IN_PROGRESS")
      throw new BadRequestException("Count cannot be completed");

    const counted = count.items.filter(
      (i) => i.counted && i.countedQty != null,
    );
    if (counted.length === 0)
      throw new BadRequestException("Nothing counted yet");

    return this.prisma.$transaction(async (tx) => {
      let totalDiff = new Prisma.Decimal(0);
      let totalValueDiff = new Prisma.Decimal(0);

      for (const item of counted) {
        const diff = new Prisma.Decimal(item.countedQty!).minus(
          item.expectedQty,
        );
        totalDiff = totalDiff.plus(diff);
        if (item.cost)
          totalValueDiff = totalValueDiff.plus(diff.times(item.cost));

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: item.countedQty! },
        });
        await tx.inventoryCountItem.update({
          where: { id: item.id },
          data: { difference: diff },
        });
      }

      const updated = await tx.inventoryCount.update({
        where: { id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          completedById: user.id,
          countedItems: counted.length,
          totalDifference: totalDiff,
          totalValueDiff: totalValueDiff,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          userName: user.nameRu,
          action: "complete_inventory_count",
          entity: "inventory_count",
          entityId: id,
          details: JSON.stringify({
            counted: counted.length,
            totalDifference: totalDiff.toString(),
          }),
        },
      });

      return updated;
    });
  }

  async cancel(id: string) {
    const count = await this.prisma.inventoryCount.findUnique({
      where: { id },
    });
    if (!count) throw new NotFoundException("Count not found");
    if (count.status === "COMPLETED")
      throw new BadRequestException("Cannot cancel a completed count");
    return this.prisma.inventoryCount.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  }
}
```

### 3.3 Controller (ADMIN-only, mirror existing guard usage)

```typescript
// inventory-count.controller.ts
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserRole } from "@prisma/client";
import { InventoryCountService } from "./inventory-count.service";
import { CreateInventoryCountDto } from "./dto/create-inventory-count.dto";
import { ListInventoryCountDto } from "./dto/list-inventory-count.dto";
import { UpdateCountItemDto } from "./dto/update-count-item.dto";

@Controller("inventory-counts")
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryCountController {
  constructor(private service: InventoryCountService) {}

  @Post()
  create(@Body() dto: CreateInventoryCountDto, @CurrentUser() user) {
    return this.service.create(dto, user);
  }

  @Get()
  list(@Query() q: ListInventoryCountDto) {
    return this.service.findAll(q);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Patch(":id/items/:itemId")
  setItem(
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() dto: UpdateCountItemDto,
  ) {
    return this.service.setItemCount(id, itemId, dto.countedQty);
  }

  @Post(":id/scan")
  scan(
    @Param("id") id: string,
    @Body() body: { barcode: string; qty?: number },
  ) {
    return this.service.scan(id, body.barcode, body.qty ?? 1);
  }

  @Post(":id/complete")
  complete(@Param("id") id: string, @CurrentUser() user) {
    return this.service.complete(id, user);
  }

  @Post(":id/cancel")
  cancel(@Param("id") id: string) {
    return this.service.cancel(id);
  }
}
```

Register `InventoryCountModule` in the root `AppModule` (only when the server/web build is active — this endpoint set is not needed on POS terminals, but living on the VPS backend it is naturally web-only).

---

## 4. Frontend — sidebar (two-level) + routing

### 4.1 Sidebar

Convert the single **Ombor / Stock** nav entry into a parent with two children. Reference config shape (adapt to the real nav model):

```typescript
{
  key: 'stock',
  labelKey: 'nav.stock',            // "Ombor" / "Склад"
  icon: <WarehouseIcon />,
  children: [
    { key: 'arrivals',   labelKey: 'nav.arrivals',   path: '/products/stock' },                 // Kirimlar (existing)
    { key: 'stocktake',  labelKey: 'nav.stocktake',  path: '/products/stock/inventarizatsiya' },  // Inventarizatsiya (new)
  ],
}
```

The parent expands/collapses; the first child points to the **existing** `/products/stock` page (no page move required). Highlight the active child based on the current path.

### 4.2 Routes (web build only)

```
/products/stock                          -> ArrivalsPage (existing, unchanged)
/products/stock/inventarizatsiya         -> InventoryCountListPage  (new)
/products/stock/inventarizatsiya/:id     -> InventoryCountDetailPage (new; counting screen)
```

Create is a **modal** launched from the list page (scope + note), not a separate route — faster and matches the reference's single "Yaratish" button.

---

## 5. List page (matches the screenshot)

`InventoryCountListPage` — top row = search (left, grows) + **Yaratish** button (right). Below = table.

Layout requirements:

- One flex row: `<SearchInput />` (flex: 1) + `<CreateButton>{t('inventoryCount.create')}</CreateButton>`.
- Debounced search (300 ms) hitting `GET /inventory-counts?search=`.
- Optional status filter chips (All / Yangi / Jarayonda / Tasdiqlandi).

Table columns (map to screenshot, minus multi-branch which POSGRO doesn't have yet):

| Column         | Source                               | Notes                                  |
| -------------- | ------------------------------------ | -------------------------------------- |
| №              | `number`                             | doc number                             |
| Ochilgan vaqti | `createdAt`                          | format `dd MMM yyyy, HH:mm` (date-fns) |
| Yopilgan vaqti | `completedAt`                        | show `—` / "Yopilmagan" when null      |
| Xodim          | `createdByName`                      |                                        |
| Holat          | `status`                             | colored badge (below)                  |
| Farq           | `totalDifference` / `totalValueDiff` | show only for COMPLETED                |
| Izoh           | `note`                               | truncate with ellipsis                 |

Row click → navigate to the detail page. Add a right-aligned `⋮` menu (Cancel, for non-completed).

Status badge (styled-components), reusing the theme palette from `themes.ts`:

```typescript
const STATUS_STYLES = {
  DRAFT: { bg: theme.colors.warning, label: "inventoryCount.status.draft" },
  IN_PROGRESS: {
    bg: theme.colors.info,
    label: "inventoryCount.status.inProgress",
  },
  COMPLETED: {
    bg: theme.colors.success,
    label: "inventoryCount.status.completed",
  },
  CANCELLED: {
    bg: theme.colors.textSecondary,
    label: "inventoryCount.status.cancelled",
  },
};
```

Empty state: centered illustration + "Hali inventarizatsiya yo'q" + a Create button.

---

## 6. Detail / counting page

`InventoryCountDetailPage` — the working screen. Header shows №, status badge, created by, and action buttons (**Yakunlash / Complete**, **Bekor qilish / Cancel**) — hidden when `COMPLETED`.

Body:

- **Barcode input** pinned at top, autofocused. On Enter → `POST /:id/scan` with the barcode → the matching line's `countedQty` increments and briefly highlights. Unknown barcode → toast "Mahsulot ro'yxatda yo'q".
- **Blind-count toggle** (default off). When on, hide the `expectedQty` and `difference` columns while counting.
- **Items table**: Product | Kutilgan (expected) | Sanaldi (counted, editable) | Farq (difference, live = counted − expected, red if negative). A quick `−/＋` stepper next to the counted input for touch use.
- On blur/change of a counted input → `PATCH /:id/items/:itemId`.
- Progress indicator: `countedItems / totalItems`.
- **Complete** button opens a confirm dialog summarizing: X of Y counted, net difference, estimated value impact. Warn if not all items counted ("Sanalmagan mahsulotlar o'zgarmaydi" — uncounted items are left untouched).

After completion the page becomes read-only and shows the final difference report.

---

## 7. Mobile-friendly rules

Web-only ≠ desktop-only. This must work on a phone/tablet browser (a manager walking the aisles). Use the existing theme breakpoints.

- **List page:** below ~640 px, drop the `<table>` and render **stacked cards** — each card shows № + status badge on the top row, opened date + employee below, difference at the bottom. The search + Create row stacks: full-width search, then full-width Create button.
- **Counting page:** the barcode input stays sticky at the top. Item rows become cards with a large counted-qty field and big `−/＋` buttons (min 44×44 px touch targets). The stepper is the primary input on mobile; the keyboard opens a numeric pad (`inputMode="decimal"`).
- Sticky header for the action bar so **Yakunlash** is always reachable.
- Test at 360 px width. No horizontal scroll on the list.

---

## 8. i18n keys

Add to both locale files.

```jsonc
// ru.json
"nav": { "stock": "Склад", "arrivals": "Приходы", "stocktake": "Инвентаризация" },
"inventoryCount": {
  "title": "Инвентаризация",
  "create": "Создать",
  "search": "Поиск по № или примечанию...",
  "columns": {
    "number": "№", "openedAt": "Открыт", "closedAt": "Закрыт",
    "employee": "Сотрудник", "status": "Статус", "difference": "Расхождение", "note": "Примечание"
  },
  "notClosed": "Не закрыт",
  "status": { "draft": "Новый", "inProgress": "В процессе", "completed": "Подтверждён", "cancelled": "Отменён" },
  "scope": { "full": "Полная", "category": "По категории", "custom": "Выборочно" },
  "detail": {
    "scan": "Отсканируйте штрих-код",
    "blindCount": "Слепой подсчёт",
    "expected": "Ожидается", "counted": "Посчитано", "difference": "Расхождение",
    "complete": "Завершить", "cancel": "Отменить",
    "progress": "{{counted}} из {{total}} посчитано",
    "uncountedWarning": "Непосчитанные товары останутся без изменений",
    "notInList": "Товар не в этом документе"
  }
}
```

```jsonc
// uz.json
"nav": { "stock": "Ombor", "arrivals": "Kirimlar", "stocktake": "Inventarizatsiya" },
"inventoryCount": {
  "title": "Inventarizatsiya",
  "create": "Yaratish",
  "search": "№ yoki izoh bo'yicha qidirish...",
  "columns": {
    "number": "№", "openedAt": "Ochilgan", "closedAt": "Yopilgan",
    "employee": "Xodim", "status": "Holat", "difference": "Farq", "note": "Izoh"
  },
  "notClosed": "Yopilmagan",
  "status": { "draft": "Yangi", "inProgress": "Jarayonda", "completed": "Tasdiqlandi", "cancelled": "Bekor qilindi" },
  "scope": { "full": "To'liq", "category": "Kategoriya bo'yicha", "custom": "Tanlab" },
  "detail": {
    "scan": "Shtrix-kodni skanerlang",
    "blindCount": "Ko'r sanoq",
    "expected": "Kutilgan", "counted": "Sanaldi", "difference": "Farq",
    "complete": "Yakunlash", "cancel": "Bekor qilish",
    "progress": "{{total}} tadan {{counted}} ta sanaldi",
    "uncountedWarning": "Sanalmagan mahsulotlar o'zgarmaydi",
    "notInList": "Mahsulot ushbu ro'yxatda yo'q"
  }
}
```

---

## 9. Acceptance checklist

- [ ] Sidebar **Ombor** expands into **Kirimlar** (→ existing `/products/stock`) and **Inventarizatsiya** (→ new page); active child highlights.
- [ ] List page: search + **Yaratish** in one row; table shows №, opened, closed, employee, status badge, difference, note; matches the reference layout.
- [ ] Create modal supports FULL / CATEGORY / CUSTOM scope; snapshots `expectedQty` at creation.
- [ ] Counting page: barcode scan increments the right line; manual edit persists; blind-count toggle works; live difference; progress counter.
- [ ] Complete applies `stock = countedQty` for counted lines only, records `difference`, writes summary + `AuditLog`, all in one transaction; document locks.
- [ ] Completed documents are read-only; Cancel blocked on completed.
- [ ] Uncounted lines are untouched on completion (verified with a partial count).
- [ ] Responsive at 360 px: list → cards, counting → touch steppers, sticky action bar.
- [ ] RU + UZ strings render everywhere; no hardcoded text.
- [ ] Endpoints reject non-ADMIN via `RolesGuard`.
- [ ] Migration applied with `migrate deploy` on the VPS — no volume reset.

---

## 10. Suggested build order

1. Prisma models + migration (Section 2).
2. NestJS module: service → controller → wire into `AppModule` (Section 3).
3. Sidebar two-level + routes (Section 4).
4. List page + Create modal (Section 5).
5. Detail/counting page incl. scan + complete (Section 6).
6. Mobile pass (Section 7) and i18n (Section 8).
7. Walk the acceptance checklist (Section 9).
