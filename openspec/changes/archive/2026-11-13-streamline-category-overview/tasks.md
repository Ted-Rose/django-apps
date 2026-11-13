# Tasks

## 1. Page layout rework

- [x] 1.1 frontend: Move the share toggle out of the chip row into
  `PageShell`'s `actions` prop as the existing `acct-icon-btn`
  share button (own view only); render the owner-switch chip row
  only when shared chips or the shared-by badge exist — verify the
  button sits right-aligned beside the title at all widths
- [x] 1.2 frontend: Delete the standalone "Filters" card; append a
  `bi-calendar3` `acct-icon-btn` to the period-chips row that
  toggles the same from/to/account form (rendered beneath the
  chips), and show `filterSummary` inline in the chips row while
  collapsed — verify clicking the icon expands/collapses the form
  and applying still reloads the overview via URL params
- [x] 1.3 frontend: Drop the Received column from the breakdown
  table (`<th>`, row `<td>`, excluded-section `colSpan` 4 → 3) and
  delete the table `<tfoot>` — verify the table renders three
  columns with no totals row
- [x] 1.4 frontend: Relocate the per-currency Spent/Received
  `StatCard` row to below the donut+table grid and the monthly
  matrix (unchanged markup) — verify totals render near the bottom
  of the page content

## 2. Chart values and selection

- [x] 2.1 frontend: Extract a pure tooltip/label helper in
  `CategoryChart.tsx` that formats `NN%` via `Math.round(share)`
  plus `-{spent} {currency}` from the row payload; wire it into
  `Tooltip`'s formatter — verify a unit test covers rounding and
  the amount string
- [x] 2.2 frontend: Add `selected` state set by `Pie` `onClick`
  and `Legend` `onClick` (resolve legend payload to the row by
  name/id, re-click clears); render a muted readout line under the
  donut `name — NN% · -spent CUR` and dim non-selected cells via
  `fillOpacity` — verify a unit test on the payload resolver and
  readout formatting passes

## 3. i18n and styles

- [x] 3.1 frontend: Add `categories.filtersToggle` to `en.json`
  and `lv.json` (calendar button title/aria-label); remove
  `filters`/`receivedCol` keys only if a repo-wide grep shows no
  remaining references — verify `npm run i18n:check --prefix
  frontend` passes
- [x] 3.2 frontend: Adjust `categories.css` only as needed
  (selected-slice readout line, filter form spacing under the
  chips) — verify no line exceeds 79 chars and visuals hold at
  360px width

## 4. Tests and docs

- [x] 4.1 frontend: Update `CategoryOverview.test.tsx` for the new
  layout (header share button, calendar toggle, three-column
  table, bottom totals) — verify `npm test -- CategoryOverview
  --prefix frontend` is green
- [x] 4.2 frontend: Run `npm run lint`, `npm run typecheck`,
  `npm run format:check` (all `--prefix frontend`) and fix any
  findings — verify all three pass
- [x] 4.3 both: Add a user-visible entry to `docs/changelog.md`
  for the category-overview UI cleanup — verify the entry matches
  the file's existing style and stays ≤79 chars/line
