# Proposal

## Why

The finance category-overview page (`/finance/` → Category spending)
has accreted chrome that fights the data: the share toggle sits on
its own line under the header, the date-range filter is a bulky
always-visible card separate from the period preset chips, a
"Received" column duplicates information categories don't need, the
headline totals compete with the table for the top of the page, and
the donut chart reveals only a one-decimal percentage on hover.

## What Changes

- Move the overview-share toggle into the page header's right-side
  actions area as a compact icon button (the `PageShell` `actions`
  slot), out of the owner-switch chip row.
- Merge the filter card into the period preset row: a calendar
  icon button sits next to the preset chips and toggles the
  from/to/account form; the standalone "Filters" card is removed.
  The active-window summary stays visible next to the chips when
  the form is collapsed.
- Drop the "Received" column from the per-category breakdown
  table (rows, section-header colSpan, and totals footer); income
  is still surfaced once in the totals cards.
- Move the per-currency Spent/Received StatCards below the
  breakdown table and monthly matrix, so totals land at the bottom
  of the page instead of the top. The table's totals footer is
  removed — the StatCards carry those figures.
- Donut chart: the slice tooltip shows a whole-number percentage
  plus the category's absolute spent amount and currency.
- Donut chart: clicking a slice OR its legend entry selects the
  category and displays the same percentage + amount readout, so
  the legend acts as a set of buttons.

## Capabilities

### New Capabilities

- `category-overview`: the finance category-overview page —
  time-window selection, per-category spending breakdown, donut
  chart, and overview sharing affordances.

### Modified Capabilities

<!-- None: no existing spec covers this page's behavior. -->

## Impact

- `frontend/src/finance/routes/CategoryOverview.tsx` — layout
  rework (header actions, chip/filter row, totals placement,
  table columns).
- `frontend/src/finance/components/CategoryChart.tsx` — tooltip
  formatter, click-to-select state shared by slices and legend.
- `frontend/src/finance/components/PageShell.tsx` — consumes the
  existing `actions` prop; no API change expected.
- `frontend/src/finance/locales/{en,lv}.json` — new keys (filter
  toggle aria-label, selection readout), possible removals
  (`filters`, `receivedCol` if orphaned — keep if used elsewhere).
- `frontend/src/finance/routes/categories.css` — minor styles for
  the filter popover/selected-slice readout if needed.
- `frontend/src/finance/routes/CategoryOverview.test.tsx` — update
  assertions for the new layout and chart behavior.
- No backend/API changes; `openapi.json` and `api-types.ts`
  untouched.
