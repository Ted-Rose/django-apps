# Design

## Context

See proposal.md for motivation. Constraints that shape the
approach:

- Notes arrive as ordinary `GoogleTask` rows: Gemini creates
  them through the Google Tasks API and sync pulls them in.
  There is no way (and no need) to stop that.
- The shared hashtag parser is `r'#([A-Za-z]{3,})'` — letters
  only, hyphens split a tag. `#notes-projects-django-apps`
  currently extracts as `notes`, `projects`, `django`, `apps`.
- `process_task_labels(user, creds, task_id=None)` is the
  single classification pass: a pre-pass fuzzy-matches every
  hashtag to `TaskLabel`s (no auto-create), the first non-star
  hashtag drives `match_task_list` → `move_task_to_list` (3
  Google API calls), then optional `_star_task_at_top`. It runs
  automatically after `sync_view` and via manual endpoints, and
  scans only `status='needsAction'`, `is_divider=False` rows.
- Local-only fields (`is_divider`, `is_starred`, …) are not in
  the sync bulk-write field lists, so pulls never clobber them.
- User decisions: notes **stay in their original Google list**;
  categories are **fluid auto-created**; notes UI is a
  **separate SPA entry** at `/notes/`.
- Perf contract (AGENTS.md): `CONN_MAX_AGE=0` on cloud —
  sync-path query counts must stay flat, not per-item.

## Goals / Non-Goals

**Goals:**

- Zero-setup classification: dictate `#notes-<path>` anywhere
  in title or body, sync, and the note lands categorized.
- Typo repair for voice input: rename/merge retags the marker
  inside member notes and pushes, so `praer` collapses into
  `prayer` permanently — in Google too.
- Full notes CRUD + category management in a dedicated SPA,
  reusing the tasks app's sync, auth, and mutation handlers.

**Non-Goals:**

- No dedicated "Notes" list in Google Tasks, no auto-move.
- Deeper than two levels (`#notes-a-b-c` → leaf `b-c` joined).
- No fuzzy category matching — fluid creation plus explicit
  merge is simpler and predictable (user's call).
- No note pinning/starring, markdown rendering, or per-notes
  trash — plain textarea bodies, unified archive/trash.
- No separate Note model — notes are `GoogleTask` rows; a
  local-only table could not capture voice-created notes anyway.

## Decisions

### 1. Dedicated notes pattern; shared regex untouched

`NOTE_TAG_RE` (roughly `#notes(?:-<seg>)*` where
`<seg> = [a-z0-9_]+`, with a trailing `(?![a-z0-9_-])`
lookahead, case-insensitive) is applied to the raw title/body.
Spelling convention: `-` is the folder boundary, `_` joins
words inside a segment (`#notes-bible_research-genesis` →
"Bible Research" → genesis); only the first segment is the
top-level dir and the leaf rejoins the rest, so `-`/`_` are
equivalent inside leaf names and both render as spaces — the
voice habit `#notes-projects-django-apps` needs no
underscores. Segments are lowercased, separators
canonicalized, and empties collapsed. Matched text is stripped
BEFORE `extract_hashtags` runs, so fragments can never reach
`match_label` / `match_task_list` / star keywords — which is
also what makes "stay in original list" work: a list whose name
starts with `note` can no longer capture notes.

- Alternative — widen `extract_hashtags` to allow hyphens:
  changes hashtag semantics repo-wide (`#home-improvement`
  stops being two tags). Rejected: regression risk for a
  personal-but-live dataset.
- Alternative — join the extracted fragments back: cannot
  distinguish `#notes-projects-django-apps` (one category
  path) from `#notes #projects` plus genuinely separate tags.
  Rejected.
- Edge covered by the lookahead: `#notebook-x` / `#notesx`
  must NOT classify as notes.

### 2. `NoteCategory` model + two denormalized fields

```text
NoteCategory: user FK | name | slug | parent FK→self (null)
              unique_together (user, parent, slug)
GoogleTask:   + is_note (bool)
              + note_category FK→NoteCategory null, SET_NULL
```

Both new `GoogleTask` fields are local-only — kept out of the
sync bulk-write field lists so pulls can't clobber them (same
pattern as `is_divider`). `note_category` is stored rather than
re-derived per request because resolution is stateful
(auto-create on first sight) and category management rewrites
state explicitly.

- Alternative — reuse `TaskLabel` with `group/leaf` names:
  leaks pseudo-hierarchy into the tasks label UI and can't
  express parent/child. Rejected.

### 3. Classification lives inside `process_task_labels`

One entry point covers every path a note can arrive by —
sync pull, the per-task endpoint, and notes-API creates —
with no new hooks into the sync writer. Per task: apply
`NOTE_TAG_RE` to title+body → set/clear `is_note`, resolve the
path → strip marker text → existing star/label/list logic runs
on the stripped text unchanged. The user's categories are
prefetched ONCE into a `(parent_slug, slug)` dict; node
creation is rare and bounded; `is_note`/`note_category`
writes flush through the run's existing bulk-update path, not
per-task saves.

### 4. The marker is the source of truth; retag on manage

Classification is recomputed each run, so the marker text must
stay accurate. Category rename/merge/delete therefore rewrites
the `#notes-…` marker wherever it appears (title or body) in
every member note and sets `needs_push`. Deleting a group
retags its whole subtree; the target is another category or
uncategorized (marker collapses to bare `#notes`). This keeps
Google Tasks — and the next voice session — consistent without
any tombstone table.

- Alternative — fuzzy-match markers to categories on read
  (like `match_label`): absorbs typos silently but also
  misfiles genuinely new categories that resemble old ones,
  and leaves wrong markers in Google forever. Rejected in
  favor of explicit, one-time retag repairs.

### 5. `/api/notes/` router, mutations reuse task handlers

New `google_tasks/notes_api.py` registered via
`api.add_router('/notes/', …)` in `django_apps/urls.py`:

- `GET /api/notes/?category&q&order` — dashboard; returns
  `notes` + `completed` + category tree + flags
  (DashboardOut-shaped)
- `POST /api/notes/` — create note; delegates to the same
  create path as `create_task_view` (Google insert → local
  row), marker appended server-side, then per-task processing
- `PATCH /api/notes/{task_id}/` — update note; marker rewrite
  + field update via the `update_task_view` path
- `POST /api/notes/categories/` — create category
- `PATCH /api/notes/categories/{id}/` — rename; retags members
- `POST /api/notes/categories/merge/` — retag + repoint + drop
  source category
- `DELETE /api/notes/categories/{id}/?to=` — subtree retag to
  target category or uncategorized

Star / complete / delete / archive / restore on a note reuse
the existing `/api/tasks/task/{id}/…` endpoints directly —
same `NinjaAPI`, same auth, no aliasing needed. The notes SPA
calls them like any other consumer.

Clients never send raw markers: create/update take
`category_id`; the server composes `#notes-<path>` (or strips
it for uncategorized→none… bare `#notes`). App-composed
markers go into the task **body** so Google-side titles stay
clean; detection accepts either field regardless.

### 6. `notes` SPA entry — mirrors the tasks shell

`frontend/src/notes/` with the four-leg slug wiring (folder,
vite input, `/api/notes/`, `/notes/` pages via
`react_app(entry='notes')` + `SPA_BASES['notes']`). Visually
mirrors `src/tasks/` but reads as a notes app:

```text
+----------------------------------------------------------+
| NAVBAR (distinct color — always know you're in notes)    |
| [Category v: All | Inbox | > projects                    |
|                |   - django-apps  - bible-research       |
|                | > god    - prayer - church | + New cat] |
|              [search icon]                 [burger menu] |
+----------------------------------------------------------+
| NoteCard: Title (marker hidden)                          |
|           body preview ~40 words · category chip · date  |
|           […: Edit | Move to category | Delete]          |
| > Completed notes (n)  (collapsible)                     |
+----------------------------------------------------------+
| floating [+] new note (pre-fills selected category)      |
+----------------------------------------------------------+
```

- Routes: `/` (all or `?category=<id>`), `/category/:id`,
  `/note/:id` (editor), `/categories` (manage page), `*` →
  `/`. Query params as source of truth, like tasks.
- `NoteCard` drops task affordances: no complete checkbox, no
  star, no order badge. Editor = TaskDetail-style page with
  title/body textareas + a category tree picker (+ a
  "not a note" escape that strips the marker → converts back
  to a plain task).
- Reuses `shared/`: api client (401/google_reauth nav free),
  queryClient, i18n (`notes` namespace, en+lv), BurgerMenu,
  Modal/Dropdown/Toasts, ConfirmModal pattern.
- New pieces only: category-tree dropdown, NoteCard,
  CategoryPicker, categories-manage page, `stripNoteMarker`
  display util. TanStack Query root `['notes']` — separate
  from `['dashboard']` so optimistic patches never cross
  (the `['search']`/`['stats']` precedent).
- Task-side exclusion: `is_note=False` added to the
  dashboard/starred/overdue/search/stats querysets; archive
  and trash stay unified.

### 7. Discovery wiring

`/notes/` link added to the home page and the SPA burger
menu items; `manage.py export_openapi_schema` +
`npm run gen:types` regenerated (CI drift gates). i18n keys
added to new `notes` en+lv catalogs.

## Risks / Trade-offs

- Voice typo → duplicate category tree nodes → merge/rename
  retag is the deliberate repair path; no silent fuzzy
  folding (user chose fluid creation).
- Markers live in user-visible Google fields → dictated notes
  show `#notes-…` in Google's app until edited; acceptable —
  it is the convention the voice flow already uses, and
  app-side writes keep it in the body.
- `process_task_labels` scans `needsAction` only → a note
  completed in Google keeps its classification (desired) but
  a marker edited on a completed note waits for un-complete
  or never reclassifies; acceptable edge.
- Deleting a group retags a whole subtree → bounded per-user
  writes (note counts are small), marked `needs_push` and
  flushed by the next sync.
- Existing tasks could coincidentally contain `#notes…` →
  they'd classify as notes on next processing; that IS the
  intended behavior for e.g. the "sealed scroll" seed note,
  and un-noting is one marker deletion away.
- Vercel build must pick up the new vite input → verify
  `build_files.sh`/manifest generation covers added entries
  (it builds all `vite.config.ts` inputs).

## Migration Plan

1. `makemigrations google_tasks` (model + 2 fields) — commit;
   hand `python manage.py migrate` to the user per convention.
2. Backend + API + urls wiring; regenerate `openapi.json` and
   `api-types.ts`.
3. Frontend entry, locales, build; scoped tests both layers.
4. Rollback: revert code, reverse the migration; misclassified
   rows lose `is_note`/`note_category` and return to being
   plain tasks — no remote state was ever touched.

## Open Questions

- Should notes get pin/star reuse later? `is_starred` already
  exists; a "Pinned" section is a cheap follow-up.
- Markdown rendering for bodies? Plain textarea MVP; renderer
  is additive.
- Expose the canonical category list for the Gemini-side voice
  skill? The categories page can offer a copyable list;
  out of scope here.
