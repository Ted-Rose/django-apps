# Tasks

## 1. Backend — model and classification

- [x] 1.1 backend: Add `NoteCategory` model (user FK, name,
  slug, parent self-FK, unique `(user, parent, slug)`) and
  `is_note` + `note_category` (FK, null, SET_NULL) local-only
  fields to `GoogleTask`; run `makemigrations google_tasks`
  and verify the migration file + `manage.py check` pass —
  hand `python manage.py migrate` to the user (agents must
  not run it)
- [x] 1.2 backend: Add `NOTE_TAG_RE` + helpers in services.py —
  marker find/strip, path resolution (`#notes` → none,
  `#notes-x` → top, `#notes-x-y…` → group+joined leaf, `_`
  joins words inside a segment and equals `-` in leaves),
  category dict get-or-create; verify with unit tests covering
  `#notes`, `#notes-household`, `#notes-projects-django-apps`,
  `#notes-bible_research-genesis`,
  `#notes-projects-django_apps` ≡ `…-django-apps`,
  case-insensitivity, and `#notebook-x`/`#notesx` rejection
- [x] 1.3 backend: Wire the notes pre-pass into
  `process_task_labels` — apply marker → set/clear `is_note` +
  `note_category` → strip marker text before
  `extract_hashtags` — keeping query count flat (one category
  prefetch, bulk writes); verify with tests for classify,
  unclassify, first-marker-wins, no label/list/star side
  effects from fragments, other hashtags still processing,
  and auto-create reuse vs. duplication

## 2. Backend — view separation and `/api/notes/`

- [x] 2.1 backend: Add `is_note=False` filters to the
  dashboard, starred, overdue, search, and stats querysets;
  verify a note row is absent from `GET /api/tasks/dashboard/`
  via a new API test while archived/trash still return it
- [x] 2.2 backend: Create `google_tasks/notes_api.py` — `GET
  /api/notes/` dashboard (notes, completed, category tree,
  filters), `POST /api/notes/` create (server appends marker
  to body, delegates to the create-task path, then per-task
  processing), `PATCH /api/notes/{id}/` update (marker
  rewrite + `needs_push`); mount via
  `api.add_router('/notes/', …)` in `django_apps/urls.py`;
  verify with endpoint tests incl. 404 cross-user scoping
- [x] 2.3 backend: Category endpoints — `POST/PATCH/DELETE
  /api/notes/categories/` + `POST …/merge/` — with marker
  retag helpers rewriting `#notes-…` in member titles/bodies
  (subtree-aware for groups) and setting `needs_push`; verify
  rename/merge/delete tests show retagged titles and dropped
  source categories
- [x] 2.4 both: Regenerate `frontend/openapi.json`
  (`export_openapi_schema`) and `src/notes/api-types.ts`
  (`npm run gen:types`); verify both drift-check commands
  produce no diff

## 3. Frontend — `notes` SPA

- [ ] 3.1 both: Wire the `notes` slug all four legs —
  `frontend/src/notes/` folder, vite `input.notes`,
  `/api/notes/` mount (2.2), and `/notes/` pages via
  `react_app(entry='notes')` + `<path:subpath>` catch-all +
  `SPA_BASES['notes']`; verify GET `/notes/` and a deep link
  return the shell and `/api/notes/` 401s map back to the SPA
- [ ] 3.2 frontend: Scaffold the entry — `main.tsx`
  (initSentry, initI18n('notes'), QueryClientProvider,
  BrowserRouter basename `/notes`, ErrorBoundary), `App.tsx`
  routes (`/`, `/category/:id`, `/note/:id`, `/categories`,
  `*` → `/`), `locales/en|lv.json`; verify `npm run dev`
  renders the shell and `i18n:check` passes
- [ ] 3.3 frontend: Notes list page — category-tree dropdown
  navbar, `NoteCard` (marker-hidden title via
  `stripNoteMarker`, ~40-word body preview, category chip,
  ⋮ menu, no complete/star controls), completed-notes
  collapsible, `['notes']`-rooted query hooks + `api.ts`
  fetchers; verify vitest for `stripNoteMarker` and card
  rendering
- [ ] 3.4 frontend: Note editor `/note/:id` (auto-resizing
  title/body, `CategoryPicker` incl. uncategorized + "not a
  note" escape) and create flow via floating `+`; verify
  vitest save/category-change flows and that markers never
  appear in inputs
- [ ] 3.5 frontend: Categories manage page — tree with counts,
  add/rename/merge/delete with `ConfirmModal`, toasts on
  retag results; verify vitest plus a manual check that a
  renamed `praer` category rewrites member markers
- [ ] 3.6 frontend: Reuse shared auth/undo patterns — verify
  dead Google creds on a notes call navigate to OAuth via the
  shared client, and `npm run lint`, `format:check`,
  `typecheck`, and `npm test` pass for the new files

## 4. Integration

- [ ] 4.1 both: Add a `notes` link to the home page and burger
  menu items; verify it renders and navigates to `/notes/`
- [ ] 4.2 both: End-to-end classification check — create a
  task titled `x #notes-god-prayer`, run processing, verify
  it appears under `god/prayer` in `/notes/` and is absent
  from `/tasks/`; run `manage.py test google_tasks` and the
  notes vitest files
- [ ] 4.3 both: Update `google_tasks/AGENTS.md`, the hashtag
  section of `google_tasks/README.md`, and
  `docs/changelog.md`; verify every touched file stays ≤79
  chars via `awk 'length > 79 {print FILENAME":"NR}'`

## Workflow follow-up

- Open a feature-branch PR per repo convention (body via temp
  file + `gh pr create --body-file`, UI verification section).
- Archive the change after merge via `openspec archive`.
