# Finance SPA UI/UX Redesign

Status: approved direction, implementation in progress.
Scope: `frontend/src/finance/` only — no backend/API changes.

## Problem

The finance SPA is a faithful React port of the old Bootstrap
templates. It works, but looks like stock Bootstrap 5: default
cards, `list-group`, `table-striped`, `alert-info` empty states,
spinner loading, everything hidden behind a burger menu. Compared
to modern fintech apps it lacks visual hierarchy, data
visualization, and visible navigation.

## Direction (decided)

- **Light modern fintech**: soft gray canvas, white elevated cards
  (radius ~14px, hairline shadow), one accent color, tabular money
  numerals. Bootstrap 5 stays as the base — a `--fin-*` design
  token layer in `finance.css` customizes it. No Tailwind, no CSS
  framework swap.
- **Tab bar under the navbar**: persistent pill tabs for the 5
  primary sections (Transactions, Categories, Limits, Balances,
  Accounts) — burger menu keeps Home/Connect/Logout + all entries.
- **recharts 3.10.1** for the Category spending donut chart.

## Design system (foundation — `frontend/src/finance/`)

`finance.css` gains design tokens and utility classes:

- `--fin-bg` `#f4f6f8` app canvas (applied via `body` scoped to a
  `.fin-app` wrapper so other pages are untouched)
- `--fin-card-radius`, `--fin-card-shadow`, `--fin-border`
- `.fin-card` — white elevated card replacing default `.card`
- `.fin-stat` — big number + label tile
- `.fin-page` — container width/padding rhythm
- `.fin-skeleton` — shimmer loading blocks replacing bare spinners
- `.fin-chip` — pill filter chips
- `.fin-money` — `font-variant-numeric: tabular-nums`
- `.fin-tabs` — sub-navbar pill tabs
- `.fin-empty` — centered icon + message empty states

New shared primitives in `frontend/src/finance/components/`:

| Component | Purpose |
|---|---|
| `PageShell.tsx` | `container` wrapper + `PageHeader` (title, subtitle, actions) used by every route |
| `StatCard.tsx` | label + big amount + optional icon/subtext |
| `EmptyState.tsx` | icon + title + hint + optional CTA, replaces `alert-info` blocks |
| `MoneyText.tsx` | sign-aware colored amount, tabular nums |
| `LoadingSkeleton.tsx` | shimmer blocks matching page layout |

`FinanceNavBar` renders a `.fin-tabs` row under the navbar with
`NavLink`s for Transactions / Categories / Limits / Balances /
Accounts (active-pill styling). `CategoryBadge` gets softer pill
styling. Existing mobile table→card CSS (`.tx-table`,
`.rules-table`) is preserved.

## Per-page plan

Each page gets one agent, scoped to its own route file + dedicated
components + an optional per-route CSS file
(`routes/<Name>.css` imported by the route — avoids shared-file
conflicts).

### Accounts (`routes/Accounts.tsx`)
- Rows → `.fin-card` account cards: name + institution/IBAN muted
  line, "Shared by …" badge kept.
- "Balance check" toggle → a real switch (`form-check
  form-switch`) instead of a colored button.
- Share icon → opens an inline input row *below* the card header
  (not crammed in the action row).
- Empty state → `EmptyState` with wallet icon + Connect CTA.

### Balances (`routes/Balances.tsx`)
- Total → `StatCard` row (one per currency).
- Account balance cards → `.fin-card` with account name, big
  `fin-money` amount, balance type + "updated X" muted footer.
- "Get latest balance" stays a primary action in the PageHeader.

### Transactions (`routes/Transactions.tsx`, `TransactionTable.tsx`, `Pagination.tsx`)
- Keep the header-dropdown table mechanics (they work); restyle:
  cleaner table (no stripes, hover only, `fin-money` amounts),
  dropdown toggles become `.fin-chip` pills.
- Active filters shown as removable chips above the table.
- Loading → `LoadingSkeleton` rows.

### CategoryOverview (`routes/CategoryOverview.tsx`)
- Headline `StatCard`s: total spent / received per currency.
- recharts donut (category share, colored by `category_color`)
  beside the breakdown table.
- Period presets → `.fin-chip` row; date/account form → compact
  toolbar.
- `ResponsiveContainer` caveat for jsdom tests — chart wrapped so
  tests don't crash (fixed height container, test asserts table).

### Limits (`routes/Limits.tsx`, `LimitItem.tsx`, `LimitForm.tsx`, `PushCard.tsx`)
- Wider container (consistent `--fin-page`), CollapsibleCards →
  `.fin-card` sections.
- `LimitItem` → card with category badge + account, thicker
  progress bars (~8px) with over-limit fill, Paused pill.
- LimitForm fields grouped with clearer section labels.

### Rules (`routes/Rules.tsx`, `RuleDrawer.tsx`)
- Two-column layout kept on desktop; categories card restyled.
- Rule rows: priority handle + category badge + readable condition
  summary kept, action buttons grouped `btn-group` ghost style.
- RuleDrawer: same fields, tidier section spacing; preview table
  → compact `.fin-card` list.

### ConnectBank (`routes/ConnectBank.tsx`)
- Centered narrow column, step-like flow: 1) country select
  (keep text input but nicer: select with common EU codes or
  labeled input), 2) bank select → bank list as selectable rows,
  3) Connect CTA.

## Conventions for agents

- Max line length 79 chars, match existing TSX style, no new
  comments unless explaining non-obvious behavior.
- No API/backend changes; keep all `useQuery`/mutation wiring and
  query keys identical.
- Keep every `aria-*`, `data-testid`, and role attribute — Vitest
  suites (`routes/*.test.tsx`) must still pass; update tests only
  where class/structure assertions genuinely change.
- Don't touch files outside the listed scope; shared primitives
  are finalized before agents start.
- Verify: `npm run typecheck` and `npx vitest run
  src/finance/routes/<Name>.test.tsx` from `frontend/` (npm at
  `/opt/homebrew/bin/npm`).
