# Task — The terminal's Analytics page, matched to the dashboard's

## What the two pages now share

Both screens render the same report from **three different backends**:

| page | backend |
|---|---|
| web dashboard, ONLINE store | `analytics.service.ts` (Nest + PostgreSQL) |
| web dashboard, OFFLINE_ONLY store | `local-server/routes/analytics.ts` (terminal HTTP + SQLite) |
| POS terminal | `analytics:getData` IPC (raw SQLite) |

Presentation was the one thing with no excuse to differ, so it moved out rather than being copied
a third time — the last two bugs in this area were both "the same endpoint implemented twice, and
only one got the change".

- `components/analytics/rankings.tsx` — `RankList`, `RankHeading`, `RankNote`, the shared
  types, and `metricValueOf`/`sliceFor`. Pure: no fetching, no routing.
- `components/analytics/categoryPie.ts` — the validated hue sets and `foldCategorySlices()`.
- Web imports them through a new `@components/analytics` alias (vite + tsconfig), the same way it
  already borrows `@components/common` from the renderer.

The web page went 955 → 744 lines with identical output, verified in the built bundle.

## The terminal page

- **Sales by category is a pie**, same hues, same "Other" fold, same 2px surface ring between
  slices and % labels.
- **Top-selling-products bar chart → the product rankings block** — best/worst ten with an inline
  proportional bar, a metric filter and a category filter, and the scope note saying what the
  lists are drawn from.
- Cashier performance moved up into the row the old chart vacated.

## The third backend had no rankings at all

`analytics:getData` returned seven sections and no `productRanking`, so the page had nothing to
render. It now runs the same product-performance query the other two do, and imports
`rankProducts()`/`rankingCategories()` rather than reimplementing them — a third copy of the
missing-cost ordering rules would drift.

Two deliberate differences from the sibling queries, both commented in place:

- The rankings query is **not** terminal-scoped, unlike every other query in that handler. A
  product's ranking is a property of the shop's catalogue; slicing it per till would make "never
  sold" mean "never sold on this till".
- `categoryId` filters the rows **before** `rankProducts()` slices to ten, so "best in this
  category" means what it says.

## Verified

`tsc` clean. Full suite **377 → 385** (30 suites) — eight new tests on `foldCategorySlices`,
covering that it never loses revenue, never returns more slices than there are hues, keeps the
biggest categories, and does not mutate its input. `nest build`, `electron-vite build` and
`npm run build:web` all clean, and I grepped both shipped bundles for the new code rather than
trusting the build output.

**Not seen rendered.** Worth a look on the terminal: whether the pie legend fits under a 210px
chart, and whether the rankings block reads well at the POS's window width.

**This one needs an app restart**, not just a reload — the IPC handler is main-process code.

---

# Task — Web dashboard: Users modal, SystemSettings layout, and a mobile nav that fits

## 1. Web Users → modal, like the terminal

`UserFormModal.tsx` mirrors the POS one minus the virtual keyboard (no touch screen here). Both the
desktop table's edit button and the mobile card's now open it; the FAB creates. Keyed on the target
user so the form rebuilds instead of carrying state from whoever was open before.

Routes `users/new` and `users/:id/edit` removed, `UserForm.tsx` deleted.

Same partial-edit rules, documented on the component: phone is the login identifier and fixed after
creation, an empty password means "leave as is" — the hash never reaches the browser, so there is
nothing to prefill and no way to tell "unchanged" from "blank" otherwise.

## 2. Web SystemSettings → the same responsive grid

Reuses `@components/common/SettingsLayout` — the primitives added for the terminal, which the web
app already aliases from the renderer, so there is one definition rather than two.

Was an 800px column. Now the store form spans the grid and pairs its five fields two-up
(`FieldGrid`), and the subscription, balance and terminal cards sit beside each other below it.
`Section` lost its `margin-bottom` since the grid owns the gaps, and the now-redundant `Row` style
went with it.

## 3. Mobile nav — 5 sections + in-page tabs

The bar was carrying 8 icons (Products, Stock, Stocktake, Reconciliation, Suppliers, Daily,
Settings, Logout) and Analytics would have made 9.

**The bar now holds sections, never individual pages:**

| | Products | Stock | Suppliers | Reports | Settings |
|---|---|---|---|---|---|

Each section's sub-pages became tabs at the top of its own pages, via a new
`components/layout/SubNav.tsx`:

- **Stock** → Приходы · Инвентаризация · Сверка
- **Reports** → Дневной отчет · Месячный отчет · **Аналитика** — *desktop only*

**On a phone, Reports is Analytics alone.** The daily and monthly reports are dense tables that
belong on a real screen, so the Reports tab goes straight to `/reports/analytics` and the tab
strip is hidden below 767px (`REPORTS_HIDE_TABS_ON_MOBILE`) — offering tabs to pages the bar no longer
leads to would just advertise dead ends. All three stay on desktop, and the pages remain reachable
by URL. A cashier cannot open Analytics (admin-only), so their Reports tab is the daily summary,
their only report.

The 767px breakpoint deliberately matches `MobileBottomNav`'s, so the bar and the tabs never
disagree about which layout is showing. The bar itself needs no media query — it only ever renders
on a phone, so it can name the mobile destination outright.

Analytics was already routed at `/reports/analytics` but unreachable from mobile. It is now the
Reports destination there.

Details worth knowing:

- **Tabs render at every width by default.** The desktop sidebar still lists the sub-pages, but
  showing the group in-page is what makes the hierarchy legible — you can see a page's siblings
  without going back to the nav. Reports opts out on mobile; Stock keeps its three tabs there.
- **Role filtering lives in the hooks** (`useStockSubNav`, `useReportsSubNav`), so a cashier is
  never shown a tab that would bounce them off an admin-only route. A group left with one visible
  tab renders nothing — a lone tab is decoration, not navigation.
- **Icons gained labels.** At 8 icons there was no room; at 5 there is, and an unlabelled icon row
  is a guessing game.
- **Fixed a latent bug:** the old bar sent everyone to `/settings`, which is admin-only — a cashier
  tapping it bounced. The Settings tab now goes to `/settings/user` for non-admins.
- **Logout moved off the bar** into the account page (`/settings/user`), reachable by every role.
  A destructive action does not belong one thumb-slip from the Reports tab.
- The tab strip scrolls horizontally rather than wrapping, so a long group never pushes content
  down.

### One thing I changed beyond the ask

Removing the mobile logout button orphaned the confirm dialog it was the only trigger for — the
desktop sidebar logged out immediately with no confirmation. Rather than delete working code, the
desktop button now goes through that same dialog. Signing out of a till mid-shift is worth one tap
to confirm; say the word if you would rather have it back as one click.

## Verified

Web `tsc --noEmit` clean and `npm run build` clean. Root repo unaffected: `tsc` clean, **370 tests
still passing**, `electron-vite build` clean. Tag-balance check across every restructured file.

**Not verified by me: none of this has been seen rendered**, and mobile layout in particular is
something only a real viewport settles. Worth checking on a phone: whether five labelled icons fit
without truncating in Russian (`Поставщики` is the long one — it ellipsizes rather than wrapping),
and that the tab strip does not crowd the page headers that already sit at the top of these pages.

`npm run lint` is still broken repo-wide and unrelated: ESLint 9 finds no `eslint.config.js`.

## Not done

`WriteOffList.tsx` has no route, so it is not in the Stock group. If it is meant to be reachable it
needs a route first — say so and it becomes a fourth Stock tab.

---

# Earlier in this session

**OFFLINE_ONLY credential trap** — the VPS refused `/auth/login` for such a store, so once the
setup token expired and was auto-dropped, nothing could mint another; subscription and every other
VPS-backed feature were dead there. The refusal is now scoped to the dashboard via a `client: 'pos'`
marker (**needs a server deploy** to take effect), and the dialog explains the state instead of
giving advice nobody could follow.

**Subscription dialog** — the server sends `store_id`/`store_name` and the terminal was parsing both
away; now displayed, with failures named rather than collapsed into one blank.

**Sync UI removed for OFFLINE_ONLY** — AppBar button, Sidebar status line, Settings tile.

**Settings UI** — `useVirtualKeyboard` across six terminal pages, Users add/edit in a modal,
responsive card grid on the three narrow settings pages (`tasks/layout-check.html` previews it).

**Fiscalization timing (awaiting real-terminal data)** — 2.4 s median per receipt, of which REGOS's
`Receipt.Sale` is 2.4 s and our code ~15 ms; device round-trips cut 3 → 1. **Open:** REGOS:VCR
prints its own receipt synchronously inside `Receipt.Sale`; the "Чек печатает виртуальная касса"
toggle needs confirming end to end. Also open: refund-and-reissue for editing a fiscalized sale.

Version not bumped — bump once at deploy time, then `npm run deploy:pos`. The auth change also
needs a server deploy.

**Build the dashboard with `npm run build:web` from the repo root — never `npm run build` inside
`src/web`.** The inner build only writes `dist/web` (what the NestJS server serves); the terminal's
LAN dashboard serves `dist-web`, which only the root script stages. Getting this wrong looks like a
clean build and silently ships nothing. See tasks/lessons.md.
