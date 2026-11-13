# Design

## Context

`frontend/src/finance/routes/CategoryOverview.tsx` renders (top to
bottom): a chip row holding owner-switch chips + the share icon
button, a standalone collapsible "Filters" card, the categories
management card, the period preset chips, the per-currency
Spent/Received `StatCard`s, then the donut + breakdown-table grid
and the monthly matrix. `CategoryChart.tsx` is a recharts donut
with a `share`-only tooltip and a non-interactive `Legend`.
`PageShell` already exposes an `actions` slot rendered
right-aligned in the page header.

## Goals / Non-Goals

**Goals:**

- One compact header: title/subtitle left, share icon button
  right (via `PageShell actions`).
- One controls row: preset chips + active-window summary +
  calendar toggle that expands the existing from/to/account form.
- A spending-only table: drop the Received column and the in-table
  totals footer; totals live in the StatCards moved to the bottom.
- A chart that reports real values: rounded % + spent amount on
  hover, and a click-selected readout driven by slice or legend.

**Non-Goals:**

- No backend/API changes — `received` stays in the API payload;
  the page just stops rendering the per-category column.
- No change to the transaction drill-down, categories management
  card, monthly matrix internals, or sharing mutations.
- No routing/param changes — `from`/`to`/`account`/`category` stay
  in the URL exactly as today.

## Decisions

- **Header share via `PageShell actions`.** Pass the existing
  `acct-icon-btn` share toggle as `actions` instead of inside the
  chip row. Alternative: an absolutely-positioned icon over the
  header — rejected, `actions` is the intended slot and already
  styles alignment. The chip row then renders only when
  owner-switch chips or the shared-by badge exist.
- **Calendar toggle inside the period-chips row.** A
  `bi-calendar3` `acct-icon-btn` sits after the last preset chip
  (before it on narrow screens is fine — flex-wrap handles it);
  `filtersOpen` state and the existing `<form onSubmit=
  {applyFilters}>` markup are reused verbatim, just rendered
  beneath the chips instead of inside a separate card. The
  `filterSummary` span moves next to the chips so the active
  window stays readable when collapsed. Alternative: a
  Bootstrap popover — rejected, adds a positioning dependency for
  a form that already works inline.
- **Chart selection is local state + a readout line.** `selected`
  holds the clicked slice's row; both `Pie`'s `onClick` and
  `Legend`'s `onClick` set it (legend payload carries the original
  datum under `.payload` — match defensively by `category_name`
  + `category_id` since recharts payload shapes vary). A muted
  line under the donut renders `name — NN% · -spent CUR`;
  re-clicking clears it. Alternative: recharts `activeIndex`/
  `activeShape` on `Pie` — rejected, it steers hover visuals, not
  a persistent readout, and is untestable in jsdom.
- **Tooltip reads the row payload.** The formatter gets
  `(value, name, item)` where `item.payload` is the
  `CategoryRowOut` — emit `${Math.round(share)}%` and
  `-{spent} {currency}` (respecting a zero-spent edge by omitting
  the amount). Extract a small pure helper for the label so the
  rounding is unit-testable without rendering recharts.
- **Non-selected slices dim, not resize.** Set `fillOpacity` ~0.4
  on non-selected cells once a selection exists; avoids recharts
  re-layouting radii (animation jank) while still marking the
  pick.
- **StatCards move below the table+chart grid and monthly
  matrix.** Same `Object.entries(data.totals)` markup, relocated;
  the `<tfoot>` is deleted and the excluded-section `colSpan`
  drops 4 → 3.
- **i18n:** new keys under `categories`: `filtersToggle`
  (aria/title for the calendar button) and `chartSelection`
  isn't needed — the readout composes existing parts; instead add
  only `filtersToggle` plus drop now-orphaned `filters`/
  `receivedCol` keys from `en.json` and `lv.json` if nothing else
  references them (grep first).

## Risks / Trade-offs

- [Recharts legend payload shape changes across versions] →
  resolve the row by name/id fallback; unit-test the resolver.
- [Tests assert on the old layout — filters card, tfoot, received
  column] → update `CategoryOverview.test.tsx` selectors in the
  same change; the route stubs `CategoryChart`, so chart logic
  gets its own focused tests via the extracted helpers.
- [Removing the Received column hides income-only categories]
  → acceptable per request; a category whose activity is purely
  income still appears (badge + share 0 + `—` spent) and totals
  still show received in the bottom cards.

## Migration Plan

Pure frontend — ship behind the normal Vite build; no data or
schema migration. Rollback is a revert.
