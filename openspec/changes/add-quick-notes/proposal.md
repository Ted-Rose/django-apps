# Proposal

## Why

The user dictates quick notes through a voice assistant (Gemini)
whose only write path is creating Google Tasks. Those notes land
in `google_tasks` as ordinary tasks and mix with real tasks,
which the user explicitly does not want — the app is used either
for tasks or for notes, never both at once. A
`#notes-<group>-<name>` hashtag convention should file each note
into an auto-created category tree, and a dedicated notes UI
should keep the two worlds separate.

## What Changes

- New SPA entry `notes` served at `/notes/` — vite input
  `notes`, folder `frontend/src/notes/`, API mount
  `/api/notes/` — with a category dropdown/tree, note list,
  full-page note editor, and a category management page
  (add, rename, merge, delete).
- `GoogleTask` gains two local-only fields: `is_note` and
  `note_category` (FK to a new `NoteCategory` model). Notes are
  ordinary synced Google Tasks underneath — they stay in
  whatever Google list they were created in, push/pull like any
  task, and are never moved between lists by the app.
- `process_task_labels` gains a notes pre-pass: a dedicated
  `#notes…` pattern (hyphen-aware, unlike the shared
  `extract_hashtags` regex which splits on hyphens) classifies a
  task as a note, resolves the category path
  (`#notes` → uncategorized, `#notes-x` → top-level `x`,
  `#notes-x-y-…` → group `x` + leaf `y-…`; `-` separates the
  two levels while `_` joins words inside a segment, so
  `#notes-bible_research` is one multi-word dir),
  auto-creates missing
  normal hashtag processing so its fragments (`notes`, `god`,
  `prayer`, …) cannot trigger label matches, unmatched
  warnings, or list moves.
- Fluid categories with typo repair: hashtags auto-create
  categories, but rename/merge/delete rewrites the `#notes-…`
  marker inside member note titles and marks them `needs_push`
  — the marker stays the durable source of truth and typo
  categories disappear instead of lingering.
- Task-facing views (dashboard, starred, overdue, search,
  stats) exclude `is_note` rows; the notes UI shows only notes.
  Archive and trash stay unified — a deleted/archived note is
  still restorable from the existing views.
- The `#notes-…` marker is hidden when rendering note titles in
  the notes UI and is edited indirectly through a category
  picker, never typed by hand in the app.

## Capabilities

### New Capabilities

- `quick-notes`: classification of `#notes-…` tasks as notes,
  the auto-created two-level category tree, the `/api/notes/`
  read/mutation surface, the `/notes/` SPA (list, editor,
  category management), and the task/notes separation
  invariant.

### Modified Capabilities

- `spa-shell`: the `notes` entry joins the enumerated SPA
  slugs (folder, vite input, `/api/notes/` mount, `/notes/`
  page prefix — all four legs wired).
- `data-isolation`: `is_note`, `note_category`, and
  `NoteCategory` rows join the enumerated per-user local-only
  state.
- `external-sync`: `is_note` and `note_category` join the
  enumerated local fields a remote pull must not clobber.

## Impact

- `google_tasks/models.py`: `NoteCategory` model, `is_note`,
  `note_category` fields — one `makemigrations` (apply handed
  to the user per convention).
- `google_tasks/services.py`: notes pre-pass inside
  `process_task_labels`; category resolution/auto-create
  helpers; retag-on-rename/merge helpers.
- `google_tasks/notes_api.py` (new): ninja router mounted at
  `/api/notes/` in `django_apps/urls.py`; mutations reuse the
  existing `views.py` task handlers through `_adapt` where
  semantics are identical.
- `django_apps/urls.py` + `django_apps/views.py`: `/notes/`
  page mount via `react_app(entry='notes')` + catch-all,
  `SPA_BASES['notes']`, home/burger nav entry.
- `frontend/`: new `src/notes/` entry (main, routes, NoteCard,
  editor, category pages), `locales/en|lv.json`,
  `vite.config.ts` input; `openapi.json` + `api-types.ts`
  regenerated per CI drift checks.
- Task views gain `is_note=False` filters — observable change:
  note rows stop appearing in the tasks SPA (intended).
- No new dependencies, no Google API surface changes, no
  dedicated Notes list created in Google Tasks.
