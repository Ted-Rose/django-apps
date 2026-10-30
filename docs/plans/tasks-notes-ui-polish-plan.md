Status: implemented

# Tasks + Notes SPA UI polish plan

Make `frontend/src/tasks/` (Google Tasks SPA) and
`frontend/src/notes/` (Notes SPA) look polished and feel cohesive,
without touching behavior, APIs, or other apps. One PR of work.

Branch: `feat/ui-polish-tasks-notes` — commit this plan file on it
first (update Status to `in progress`, then `implemented` on
completion). Commit format: `Type: Capitalized message`
(Feat/Fix/Docs/Refactor/Test/Chore).

## Design direction

Adopt the pattern `frontend/src/finance/finance.css` already proves
in this repo (DO NOT touch finance files — read-only reference):

- A scoped `.app-ui` wrapper carries design tokens as CSS custom
  properties: soft gray canvas (`--ui-bg: #f4f6f8`), white elevated
  surfaces (`--ui-surface`), hairline borders (`--ui-border`),
  rounded corners (`--ui-radius: 0.75rem`), a two-layer soft shadow
  (`--ui-shadow`) and a slightly deeper hover shadow.
- Cards sit on the gray canvas: subtle border + shadow + radius,
  gentle hover lift — replacing today's flat white `.card` defaults.
- Clear visual hierarchy: card titles back to ~0.95–1rem (they are
  currently shrunk to 0.8em), meta rows in muted 0.8rem, bold
  section headers.
- Proper empty/loading/error states via shared presentational
  components (the `.fin-empty` / `.fin-skeleton` idea, generalized
  to `.ui-empty` / `.ui-skeleton`).
- Accessible focus: a `:focus-visible` ring token applied inside
  `.app-ui`; clickable icons become real `<button>`s.
- Per-app accent: tasks keeps `bg-primary` chrome, notes keeps
  `bg-dark` (the deliberate "never reads as tasks" rule in
  `notes/dashboard.css` and `NotesNavBar.tsx`) — same card/state
  system underneath via a shared token file.
- Extend, do not replace: the styling system stays plain CSS files
  + Bootstrap 5.3 utilities + Bootstrap Icons from the spa_shell CDN
  links (`django_apps/templates/spa_shell.html:9-14`). No CSS
  modules, no Tailwind, no new dependencies.

## Audit — what is ugly / inconsistent today

### Visual flatness and missing design language

- `frontend/src/tasks/dashboard.css` is a verbatim port of the old
  template CSS (header comment, lines 1–5) — hardcoded hex colors,
  stock Bootstrap cards on a white canvas, no tokens. Palette even
  carries Bootstrap-4 leftovers: `#28a745` (line 56) and `#007bff`
  (line 65) vs the BS5 `#198754`/`#0d6efd` used elsewhere.
- `frontend/src/notes/dashboard.css` `@import`s the tasks file
  (line 5) so notes inherits every flaw plus only 30 lines of
  notes-only tweaks.
- `.task-card` (dashboard.css:6–25) is a flat default card: 0.375rem
  radius, no border tinting, a single hover shadow. Title and body
  text are shrunk to `0.8em` (lines 74–98) — cramped, weak
  hierarchy.
- `body { padding-top: 60px }` and `.navbar { position: fixed
  !important …}` (dashboard.css:257–268) — global hacks with
  `!important` instead of a scoped layout rule.
- `cursor: grab` is applied to every `.task-card` /
  `.task-content` (dashboard.css:8, 105–110) even when
  `draggable=false` (non-manual orders) — the cursor lies.

### Dead or unfinished CSS

- `.stats-bar-segment` is rendered in `tasks/routes/Stats.tsx`
  (lines 312, 323) and asserted by `Stats.test.tsx:130` but has NO
  CSS definition anywhere — bars are naked inline-styled divs.
- `.filter-bar` (dashboard.css:41–44) is unused — no element carries
  the class.

### Duplicated code

- `tasks/components/ConfirmModal.tsx` vs
  `notes/components/ConfirmModal.tsx` — near-identical; the notes
  copy only adds `confirmDisabled` (line 19).
- `LoadingSkeleton`, `ErrorState`, `EmptyState` are defined in
  `tasks/routes/TaskListPage.tsx:517–589` AND copy-pasted in
  `notes/routes/NotesPage.tsx:188–263` — exported out of route
  files.
- The minimal `<nav>` block is copy-pasted 7 times with the same
  inline styles (`padding: '0.1rem 0'`, `padding: '0 0.5rem'`):
  `tasks/routes/Archived.tsx:117–149`, `Trash.tsx:108–139`,
  `Search.tsx:130–149`, `Stats.tsx:115–149`, `Labels.tsx:97–131`,
  `notes/routes/NoteDetail.tsx:169–194`,
  `notes/routes/Categories.tsx:189–215`.
- `TOGGLE_STYLE = { padding: '0.15rem 0.4rem' }` is triplicated:
  `TaskNavBar.tsx:25`, `NotesNavBar.tsx:25`,
  `SecondaryLabelDropdown.tsx:27` (plus per-call inline padding on
  search/back buttons in every route).

### Weak / repeated state blocks

- Every empty state is a hand-rolled `alert alert-*` box — 8+ near
  identical icon+heading+hint copies: `TaskListPage.tsx:562–589`,
  `NotesPage.tsx:233–263`, `Search.tsx:197–219`,
  `Archived.tsx:168–171`, `Trash.tsx:161–163`, `Labels.tsx:138–140`,
  `Stats.tsx:155–159`, `notes/routes/Categories.tsx:279–281`.
- Loading skeletons use stock `placeholder-glow` bars
  (`TaskListPage.tsx:517–535`, `NotesPage.tsx:188–206`) — no
  shimmer; finance already has the nicer pattern.

### Accessibility gaps

- `.star-btn`, `.complete-btn`, `.uncomplete-btn` are
  `<span role="button">` — NOT keyboard focusable, no Enter/Space
  activation: `TaskCard.tsx:123–154`, `CompletedSection.tsx:125–153`,
  `Archived.tsx:226–245`, `TaskDetail.tsx:208–219`,
  `Search.tsx:240–260`, `NotesPage`/`NoteCard` use the same idioms.
- `.delete-divider-btn` only appears on `:hover`
  (dashboard.css:163–170) — invisible to keyboard and touch users;
  needs `:focus-within` + a mobile fallback.
- No `:focus-visible` styles exist anywhere in either app.
- `Modal.tsx` mounts already `.fade show` so the transition never
  plays — the dialog pops in instantly.

### Inline styles and inconsistency

- Inline `style={{…}}` scattered through 12+ files: navbar paddings,
  `NotesNavBar.tsx:247` search width, `Labels.tsx:199/209` color
  input sizes + `fontFamily: 'monospace'`, `Stats.tsx:339`
  `fontSize: '0.6rem'`, `TaskListPage.tsx:504–510` display toggle,
  `TaskFormModal.tsx:184` label-box maxHeight.
- Label pickers disagree: `TaskFormModal.tsx:179–211` uses a
  checkbox list, `TaskDetail.tsx:311–341` uses badge-toggle chips —
  pick one idiom (chips).
- `notes/routes/Categories.tsx:160–182`: three text-labeled buttons
  per row overflow on narrow screens.
- `Trash.tsx` uses `bg-danger` navbar + `border-danger` cards — the
  only color coding; worth formalizing as a `variant` rather than a
  one-off.
- Toasts (`shared/components/Toasts.css`) are raw fixed-position
  alerts — no radius/shadow refinement.
- Burger menu wraps awkwardly on mid-width screens in tasks (8+
  items); finance already patched this in `finance.css:16–20`, tasks
  never got the fix.

### Test / behavior hooks that must be preserved

Class names and ids asserted by tests or used by logic — restyle,
do NOT rename or remove: `.task-container`, `.task-card`,
`.task-content`, `.task-order-badge`, `.order-btn`, `.star-btn` +
`.starred`, `.complete-btn`, `.uncomplete-btn`, `.divider-card`,
`.divider-body`, `.divider-text`, `.divider-drag-handle`,
`.delete-divider-btn`, `.task-title-link`, `.floating-add-btn`,
`.undo-redo-controls`, `#task-list`, `#note-list`, `#save-indicator`,
`#back-to-dashboard-btn`, `#back-btn`, `#undo-btn`, `#redo-btn`,
`#completedChevron`, `#completedTasksCollapse`, `.dropdown-menu` +
`.show`, `#task-form`, `#task-title`, `#task-notes`, `#note-form`,
`#note-title`, `#note-body`, `#label-selector`, `#alert-container`,
`data-task-id`, `data-position`, `.note-category-chip`,
`.category-picker-option` (+ `.selected`), `.stats-bar-segment`,
`.action-toast`, `.burger-menu`, `.burger-icon`,
`.burger-menu-items`, `.burger-menu-divider`, `#search-q`,
`#search-status`, `#task-order`, `#starred-order`,
`.label-checkbox`, `#merge-target`, `#delete-target`,
`#rename-category`, `#back-to-notes-btn`, `#taskForm*`,
`.task-detail-container`, `.task-meta`, `.header-section`,
`.search-form`.

## Workstreams

DISJOINT FILE SETS — a file may appear in exactly one workstream.
WS-shared must land first (in-branch commit order) because the app
workstreams import the new shared components; alternatively build
the whole PR in one branch with WS-shared committed first.

Note the deliberate coupling: `notes/dashboard.css` imports
`tasks/dashboard.css`. WS-tasks owns that file; WS-notes gets the
card/state polish for free through the import and must NOT edit
tasks files for it.

### WS-shared — design tokens + shared components

Scope: `frontend/src/shared/` only. Creates new files and edits
only shared CSS/locale files; never touches app files.

1. Create `frontend/src/shared/ui.css` — the token + shared-class
   layer. Contents:
   - `.app-ui` scope: `--ui-bg`, `--ui-surface`, `--ui-border`,
     `--ui-radius`, `--ui-radius-sm`, `--ui-shadow`,
     `--ui-shadow-hover`, `--ui-accent`, `--ui-focus-ring`,
     `background-color: var(--ui-bg)`, `min-height`.
   - `.ui-card` — surface, 1px border, radius, shadow, transition,
     hover lift (translateY(-1px) + deeper shadow).
   - `.ui-empty` — centered, big muted `bi` icon, `h2.h5` title,
     muted hint (mirror `.fin-empty` in finance.css:140–150).
   - `.ui-skeleton` + `@keyframes ui-shimmer` — mirror
     `.fin-skeleton` (finance.css:124–137).
   - `.ui-ghost-btn` — borderless icon button with hover/focus bg
     (mirror `.fin-ghost-btn`, finance.css:173–190, incl. a
     `ui-ghost-danger` variant).
   - `.ui-chip` — pill chip for filter/category chips (mirror
     `.fin-chip`, finance.css:66–92, incl. `.active` state).
   - `.ui-nav-toggle` — replaces the triplicated `TOGGLE_STYLE`
     padding for navbar dropdown toggles and icon buttons.
   - Scoped polish inside `.app-ui`: `.modal`/`modal-dialog` enter
     animation (fade + slight scale/translate — fixes the
     never-playing transition), `.modal-content` radius + shadow,
     `.dropdown-menu` radius/shadow/item radius, `.form-control` /
     `.form-select` `:focus` ring using `--ui-accent`,
     `:focus-visible` outline ring on interactive elements.
   - Acceptance: file compiles via both app CSS imports; every line
     ≤ 79 chars; colors come from tokens or `var(--bs-*)`, no
     Bootstrap-4 leftovers.

2. Create `frontend/src/shared/components/ConfirmModal.tsx` —
   merged superset of the two app copies: props `show`, `title`,
   `confirmLabel`, `confirmIcon?`, `confirmClassName?`
   (default `btn-primary`), `confirmDisabled?` (from the notes
   variant), `busy?`, `onConfirm`, `onClose`, `children`.
   - Acceptance: drop-in replacement for BOTH app versions
     (callers unchanged except the import path); Cancel label from
     `common:common.cancel` like today.

3. Create `frontend/src/shared/components/EmptyState.tsx` —
   presentational `{icon, title, children?}` rendering `.ui-empty`
   (mirror `finance/components/EmptyState.tsx` but on `.ui-empty`).

4. Create `frontend/src/shared/components/ListSkeleton.tsx` —
   `{rows?, height?, label?}` shimmer blocks (`.ui-skeleton`),
   `aria-busy`, `role="status"`, default label
   `t('common:common.loading')`.

5. Create `frontend/src/shared/components/ErrorState.tsx` —
   `{title, detail?, onRetry}`: centered icon
   (`bi-exclamation-circle`), title, muted detail, retry button
   labeled `t('common:common.retry')`.

6. Create `frontend/src/shared/components/PageNavBar.tsx` —
   deduplicates the 7 copy-pasted `<nav>` blocks. Props:
   `variant: 'primary' | 'dark' | 'danger'` (maps to
   `navbar-dark bg-*`), `burgerItems: BurgerMenuItem[]`,
   `children` (left slot), `actions` (right slot, e.g. the search
   button). Renders the fixed navbar with the padding classes
   (`.app-navbar` in ui.css or dashboard.css — pick ONE home and
   document it; suggest ui.css `.app-navbar`).
   - Acceptance: pixel-equivalent markup to the current navs
     (same classes minus inline styles); burger menu and language
     switcher still render.

7. Edit `frontend/src/shared/components/BurgerMenu.css`:
   - Add the finance wrap fix: `.burger-menu-items { flex-wrap:
     wrap; justify-content: flex-end; row-gap: 0.25rem; }`
     (port of finance.css:16–20 — tasks' 8-item menu wraps cleanly).
   - Polish the mobile dropdown: `--ui-radius` corners, deeper
     shadow, small top margin already present.
   - Acceptance: `BurgerMenu.test.tsx` still passes (markup
     unchanged — CSS only).

8. Edit `frontend/src/shared/components/Toasts.css`: toast alerts
   get radius (`--ui-radius` fallback `0.5rem` — Toasts renders
   inside `.app-ui` so the token resolves), shadow, slightly
   tighter padding.
   - Acceptance: `.action-toast`/`.show` hooks unchanged.

9. Edit `frontend/src/shared/locales/en.json` and `lv.json` — add
   keys ONLY if the new shared components need them (current
   design takes localized strings as props; `common.retry`,
   `common.loading`, `common.cancel`, `common.close` already
   exist). If any key is added, add it to BOTH files.
   - Candidate (only if a shared "no results" default emerges):
     none expected — prefer props.

10. Create colocated tests:
    `shared/components/ConfirmModal.test.tsx`,
    `EmptyState.test.tsx`, `PageNavBar.test.tsx` — minimal render
    smoke tests (open/close callback fires, variant class applied,
    children render). Follow `BurgerMenu.test.tsx` conventions.

### WS-tasks — `frontend/src/tasks/` only

1. `tasks/App.tsx` — wrap `<Routes>` in
   `<div className="app-ui">` so the whole SPA gets the canvas +
   tokens. Acceptance: every route page shows the gray canvas.

2. `tasks/dashboard.css` — full rewrite onto tokens (keep EVERY
   hook selector listed above):
   - `@import '../shared/ui.css';` at the top.
   - `.task-card` → elevated card (`--ui-*` border/radius/shadow,
     hover lift). Keep `.sortable-ghost`/`.sortable-chosen` hooks,
     retune to tokens. Grab cursor moves to
     `.task-list-drag .task-card` / a `draggable` modifier (see
     task 4) — no more lying cursor.
   - Card title back to ~0.95rem `font-weight: 600`; card-text
     ~0.85rem; meta `small` muted — real hierarchy.
   - Fix BS4 colors: `.complete-btn:hover` → `var(--bs-success)`,
     `.uncomplete-btn:hover` → `var(--bs-primary)`; star
     `#ffc107` → `var(--bs-warning)` or token.
   - `.order-btn` — softer strip (subtle left border or muted
     chip look); keep `#` pseudo-element.
   - Delete `.filter-bar` (dead). DEFINE `.stats-bar-segment`:
     `border-radius: 2px` top segment, `min-width`, subtle
     transition — fixes the unstyled bars.
   - `.delete-divider-btn`: visible on `.divider-card:hover` AND
     `:focus-within`; on `@media (hover: none)` always show at
     low opacity.
   - `.search-form`, `.task-meta`, `.task-detail-container` →
     token surfaces; `.floating-add-btn`, `.undo-redo-controls`,
     `#save-indicator` → token shadows + `:focus-visible` rings.
   - Add `.app-nav-toggle` (or reuse `.ui-nav-toggle`) for the
     dropdown/back/search buttons; add `.filter-chips` styles for
     task 6.
   - Acceptance: `awk 'length > 79'` clean; every removed rule has
     its selector still present or documented as dead.

3. `tasks/components/TaskCard.tsx`:
   - Convert `.complete-btn`/`.star-btn` spans to
     `<button type="button" className="star-btn …">` (reset button
     chrome in CSS via `.ui-ghost-btn`-like rule) — keyboard
     focusable. Keep the class names and icon structure (tests
     click `.star-btn`, assert `.starred`, `.bi-star-fill`).
   - Add a `task-card--draggable` class (or `[draggable]`-driven
     parent class in TaskListPage) so the grab cursor only shows
     when drag is real.
   - Keep `data-task-id`, `data-position`, `.task-order-badge`,
     the `Dropdown` ⋮ menu (restyle its toggle via CSS class
     instead of `btn-link text-muted` — ghost look).
   - Due-date emphasis: when `view === 'overdue'` (pass a prop or
     use `starredView`-style flag) render the due badge
     `text-danger`.
   - Acceptance: `TaskCard.test.tsx` passes unmodified or with
     only intentional markup updates; star/complete keyboard-
     activatable.

4. `tasks/routes/TaskListPage.tsx`:
   - Put `task-list-drag` on the `#task-list` wrapper when
     `dragEnabled` (drives the cursor fix).
   - Replace local `LoadingSkeleton`/`ErrorState` internals with
     the new shared components — keep exported names working for
     the other route files, OR repoint every importer
     (`Archived.tsx`, `Trash.tsx`, `Stats.tsx`, `Labels.tsx`,
     `Search.tsx`, `TaskDetail.tsx` — all in-scope).
   - `EmptyState` keeps its credential/starred branching but
     renders the shared `EmptyState` presentational component.
   - `#save-indicator` → floating pill styling via class (remove
     inline display toggle in favor of a `.show` class).
   - Acceptance: all three dashboard-shaped views render
     skeleton/empty/error via shared components; undo/redo and
     floating + unchanged functionally.

5. `tasks/components/CompletedSection.tsx` — span→button
   conversion for star/uncomplete; completed rows get a lighter
   `.ui-card`-flat look (keep `border-0 bg-light` hooks or map to
   a `.task-card--done` class — keep the existing classes for
   tests). Acceptance: `CompletedSection.test.tsx` passes.

6. `tasks/components/TaskNavBar.tsx` +
   `components/SecondaryLabelDropdown.tsx`:
   - Remove `TOGGLE_STYLE` and per-button inline styles → shared
     `.ui-nav-toggle` class.
   - Add an active-filter chips row under the navbar (inside the
     same nav or a `.filter-chips` bar): when `?list=`, `?label=`
     or `?secondary_label=` is set show a `.ui-chip.active`-style
     chip with the name and an `×` that clears that one param.
   - New i18n keys (add to BOTH `tasks/locales/en.json` and
     `tasks/locales/lv.json`):
     - `filters.remove` — "Remove filter" / "Noņemt filtru"
     - `filters.active` — "Filters" / "Filtri"
   - Acceptance: `TaskNavBar.test.tsx` passes; chips appear only
     with active filters and clear correctly; URL stays source of
     truth.

7. `tasks/routes/Archived.tsx`, `Trash.tsx`, `Search.tsx`,
   `Stats.tsx`, `Labels.tsx`, `TaskDetail.tsx`:
   - Replace each inline `<nav>` with shared `PageNavBar`
     (`variant`: primary; `danger` for Trash). Keep `#back-*`
     ids and the search button link.
   - Replace `alert`-box empty/error states with shared
     `EmptyState`/`ErrorState`/`ListSkeleton`.
   - `Stats.tsx`: SummaryCard → `.ui-card` look (big number,
     muted label, colored delta with `bi-arrow-up/down` icons);
     `.stats-bar-segment` now styled; tables keep `table-sm` but
     sit inside `.ui-card`.
   - `Labels.tsx`: replace inline `style` on the color/hex inputs
     with classes (`.label-color-input`, `.label-hex-input`) in
     dashboard.css.
   - `Search.tsx`: autofocus the `q` input on mount; restyle
     `.search-form` via the new token surface; results keep
     `SearchResultCard` (share TaskCard look via CSS — it already
     uses `.task-card`).
   - `TaskDetail.tsx`: `#task-title` keeps borderless look but
     gains a subtle focus/bottom-border affordance; label toggles
     and meta badges refined; star `<span>` → `<button>`.
   - Acceptance: page-level test files (`Archived.test.tsx`,
     `Trash.test.tsx`, `Search.test.tsx`, `Stats.test.tsx`,
     `Labels.test.tsx`, `TaskDetail.test.tsx`) pass — update only
     for intentional markup changes.

8. Delete `tasks/components/ConfirmModal.tsx`; repoint its
   importers (`TaskCard.tsx`, `CompletedSection.tsx`,
   `DividerCard.tsx`, `routes/Trash.tsx`) to
   `shared/components/ConfirmModal`. Acceptance: no references to
   `../components/ConfirmModal` or `./ConfirmModal` remain under
   `src/tasks/`.

9. `tasks/components/TaskFormModal.tsx` — replace the checkbox
   list with the same badge-toggle chips TaskDetail uses
   (`#label-selector`-style; extract the styling into a reusable
   `.label-chip` rule in dashboard.css so both pickers share it).
   Move the `maxHeight: '150px'` inline style to the CSS class.
   Acceptance: creating a task with labels still posts
   `label_ids`; chips show checked/unchecked states.

10. `tasks/locales/en.json` + `lv.json` — add the `filters.*`
    keys from task 6 (any other new UI copy must land in BOTH
    files; run `npm run i18n:check`).

11. Update test files ONLY where markup intentionally changed
    (span→button still matches `.star-btn` selectors — most tests
    should pass untouched). Run:
    `npx vitest run src/tasks` — all green.

### WS-notes — `frontend/src/notes/` only

1. `notes/App.tsx` — wrap `<Routes>` in
   `<div className="app-ui">`. Acceptance: gray canvas on every
   notes page.

2. `notes/dashboard.css`:
   - Add explicit `@import '../shared/ui.css';` (before the tasks
     import is fine — tokens cascade).
   - `.note-category-chip` → pill look using `--ui-*` tokens
     (rounded-full, subtle border, hover accent for the link
     variant).
   - `.category-picker-option` — add `:focus-visible` ring and
     token-based selected/hover states.
   - Any notes-only accent override via `.app-ui` scoped
     variables here (NOT in tasks files).
   - Acceptance: tasks CSS hooks still resolve through the
     existing `@import '../tasks/dashboard.css'`; ≤ 79 chars.

3. `notes/routes/NotesPage.tsx`:
   - Delete the local `LoadingSkeleton`/`ErrorState`/`EmptyState`
     definitions; use the shared components (repoint the importers
     `NoteDetail.tsx`, `Categories.tsx`).
   - `EmptyState` keeps auth/search/empty branching, renders the
     shared presentational component.
   - Completed-notes toggle row gets the same polish as tasks'
     completed section.
   - Acceptance: `NotesPage` renders states via shared
     components; create + button works unchanged.

4. `notes/components/NoteCard.tsx`:
   - ⋮ menu toggle → ghost-icon look via class (drop
     `btn-link text-muted` for a `.ui-ghost-btn`-consistent
     class).
   - Category chip uses the restyled `.note-category-chip`.
   - Keep `data-task-id`, `.task-container`, `.task-card`,
     `.task-title-link`, `.task-content` hooks (tests + tasks CSS
     inheritance do the visual lift).
   - Acceptance: `NoteCard.test.tsx` passes (it asserts absence of
     `.complete-btn`/`.star-btn`/`.task-order-badge` — keep it
     that way).

5. `notes/components/NotesNavBar.tsx`:
   - Remove `TOGGLE_STYLE`/inline styles → `.ui-nav-toggle`.
   - Search input: replace `width: '10rem'` inline style with a
     responsive class (e.g. `.notes-search-input` in
     notes/dashboard.css — `width: 10rem; max-width: 40vw`).
   - Acceptance: search open/submit/close behavior unchanged;
     category dropdown untouched except styling.

6. `notes/routes/Categories.tsx`:
   - Replace the inline `<nav>` with `PageNavBar variant="dark"`;
     keep `#back-to-notes-btn`.
   - Replace `alert` empty state with shared `EmptyState`; add-
     category form card gets `.ui-card` look.
   - Row actions: hide text labels on small screens
     (`<span className="d-none d-sm-inline">` inside the buttons)
     or switch to ghost icon buttons — no more overflow on mobile.
   - Acceptance: rename/merge/delete flows still work; table
     readable at 360px width.

7. `notes/routes/NoteDetail.tsx`:
   - Replace the inline `<nav>` with `PageNavBar variant="dark"`;
     keep the back button + brand link.
   - `.task-meta` picks up the restyled surface automatically via
     the tasks CSS import — verify, don't duplicate.
   - Replace `alert` blocks for `missing`/`notANote` with shared
     `EmptyState` where reasonable.
   - Acceptance: `NoteDetail.test.tsx` passes; editor unchanged
     functionally.

8. Delete `notes/components/ConfirmModal.tsx`; repoint importers
   (`NoteCard.tsx`, `routes/Categories.tsx`) to the shared
   ConfirmModal (the shared version covers `confirmDisabled`).
   Acceptance: no local ConfirmModal remains under `src/notes/`.

9. `notes/components/NoteFormModal.tsx`,
   `components/CategoryPicker.tsx` — minor only: ensure picker
   rows get the new focus/selected styles from notes/dashboard.css
   (TSX changes only if a class hook is needed).

10. `notes/locales/en.json` + `lv.json` — add keys ONLY for new
    copy (none expected beyond possibly a shared-state label;
    keep parity, run `npm run i18n:check`).

11. Run `npx vitest run src/notes` — all green; update tests only
    for intentional markup changes.

## Explicitly forbidden

- No backend changes: no `*.py`, no `*/api.py`, no
  `api-types.ts`/`api.ts` edits (api-types are generated;
  `openapi.json` must stay drift-free), no `manage.py` runs needed.
- No new npm dependencies — the design uses plain CSS + existing
  Bootstrap/Icons (justify in the PR if you believe an exception is
  warranted; expect pushback).
- No changes outside `frontend/src/{tasks,notes,shared}` — finance,
  gmail, single_pages, templates, terraform, docs all stay
  untouched (except this plan file, which is the deliverable).
- No breaking existing tests: keep the DOM hooks listed in the
  audit; update test files only where markup intentionally changed.
- No renaming/removing the listed CSS hooks or `data-*`/`id`
  attributes — notes CSS, e2e selectors and dnd rely on them.
- No committing on `main`; stage only files changed this session
  by path (`git status` first; never `git add -A`).
- Do NOT run `npm run format` blind — run `format:check` and fix
  flagged files individually.
- Remember `docs/plans/` note: feature plans normally live in
  openspec now; this file exists because it was explicitly
  requested here — do not create additional plan files.

## Verification

Run everything from `frontend/` (or `npm run <s> --prefix frontend`
from repo root):

```bash
npm run lint            # eslint — fix errors (warnings pre-existing
                        # are ok, don't add new ones)
npm run format:check    # prettier — fix only flagged files
npm run typecheck       # tsc --noEmit
npm test                # vitest — all suites green
npm run i18n:check      # locale catalog parity en ↔ lv
npm run build           # tsc + vite build → frontend_dist/
```

Scoped test runs while iterating:

```bash
npx vitest run src/tasks src/notes src/shared
```

Line-length rule on every touched file (all types):

```bash
awk 'length > 79 {print FILENAME":"NR}' <file>
```

Manual UI smoke (the real check — visual work needs eyes):
`VITE_DEV=1 python manage.py runserver` + `npm run dev
--prefix frontend`, then verify at /tasks/ and /notes/:

- Dashboard: cards elevated on gray canvas, hover lift, star/
  complete keyboard-tabbable, drag cursor only in manual order.
- Navbar: filter chips appear/clear correctly; burger menu wraps
  on narrow widths; mobile (< 768px) layout sane.
- Empty/error/skeleton states look consistent across dashboard,
  starred, overdue, archived, trash, search, stats, labels,
  detail — and notes list, categories, note detail.
- Modals animate in; confirm dialogs identical in both apps.
- `?lang=lv` spot-check: new strings translated.

Deploy note (owner action, not part of this PR): bump
`PWA_CACHE_VERSION` in `django_apps/views.py` when shipping —
frontend-only changes still need the cache-bust.

## Suggested commit sequence (single branch)

1. `Docs: Add tasks/notes UI polish plan` (this file, Status:
   in progress)
2. `Feat: Add shared UI tokens and shared components` (WS-shared)
3. `Refactor: Restyle tasks SPA on shared UI tokens` (WS-tasks)
4. `Refactor: Restyle notes SPA on shared UI tokens` (WS-notes)
5. `Docs: Mark tasks/notes UI polish plan implemented` (Status)
