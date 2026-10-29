# google_tasks — Agent Guide

Largest app in the project: a Google Tasks client with bidirectional
sync and several local-only features. Full behavior docs:
`README.md` in this directory.

## Sync model (services.py)

`sync_all(user, creds)` → `sync_task_lists` + `sync_tasks`, where
`sync_tasks` first runs `push_local_changes` (push tasks with
`needs_push=True`) then pulls remote state. Lists pull in PARALLEL
(`_pull_list_pages` per list on a ThreadPoolExecutor — each thread
builds its own service since httplib2.Http is not thread-safe;
pages within a list stay sequential on `nextPageToken`). The pull
classifies every remote item against one in-memory snapshot in
`_write_remote_tasks`, then flushes via `bulk_create` (with
`update_conflicts` for raced inserts) / `bulk_update` — per-item
ORM calls timed syncs out at Vercel's 300s cap. Bulk writes bypass
`save()`/signals. Every ORM round-trip matters: cloud deploys run
`CONN_MAX_AGE=0`, so each query is a fresh connection handshake —
keep sync query counts flat, not per-item or per-list.

- Recurring tasks: Google spawns a new remote entity per occurrence
  and suppresses the old one from `tasks().list` (still resolvable
  via `tasks().get`, parked at position INT32_MAX). `_write_remote_tasks`
  merges an unknown remote id into the single open, same-titled local
  row whose id vanished from the pull — 0 or ≥2 candidates just
  creates — and returns the post-merge snapshot. `_trash_ghost_tasks`
  then detects, in memory, every remaining same-titled row absent
  from the pull and flips it `is_deleted` + `needs_push` in ONE
  update, so the next push deletes the suppressed remote instances.
  Both helpers need the complete remote id set across ALL lists (a
  remote move between lists must not look like suppression), so
  `sync_tasks` fetches every list's pages before writing anything.

- Local edits set `needs_push=True`; push clears it and stamps
  `last_synced_at`.
- Push of an `is_deleted` task deletes it in Google. Push that hits a
  remote 404 **recreates** the task via insert (local DB is source of
  truth) and rewrites `task.task_id`.
- Moving between lists = get + insert + delete (Google has no move op);
  `move_task_to_list` updates the local `task_id`/`task_list` after.
- Every service may return `{'authorization_url', ...}` — views must
  redirect into OAuth when that happens.

## Local-only fields on GoogleTask — never send to Google

`is_starred`, `is_divider`, `task_order`, `starred_order`,
`is_archived`, `is_deleted`, `deleted_at`, `labels` (M2M
`TaskLabel`), `is_note`, `note_category` (FK `NoteCategory`).

- Dividers are `GoogleTask` rows with `is_divider=True` and
  `task_id='divider_{uuid}'`; excluded from sync and label processing.
- Ordering uses float positions (midpoint strategy).
  `_apply_reorder` validates payloads (cap `REORDER_CAP=500`, unique
  positions, no bools) then does a **two-phase** `bulk_update`:
  temporary negative positions first, then finals — required so row
  swaps don't trip the per-user unique constraints. Those constraints
  are still commented out in `models.py` pending a follow-up migration;
  keep the two-phase pattern regardless.
- Archive/trash are local-only; trash UI advertises a 30-day purge but
  no purge job exists — only `permanent_delete_task_view`.

## Hashtag label processing (`process_task_labels`)

- `#xxx` (3+ letters) in title/notes → `match_label`: exact →
  4-char prefix → fuzzy `SequenceMatcher >= 0.80` → 3-char prefix.
  `LABEL_AUTO_CREATE=False` by default. A pre-pass still matches all
  hashtags before any mutation, but unmatched hashtags are **not**
  fatal: they get no label, are warning-logged, and land in
  `stats['unmatched']` while every other task keeps processing.
- Perf contract: the task queryset is `select_related('task_list')`,
  the user's labels are prefetched ONCE and passed to `match_label`
  via `labels=`, and label assignments flush as ONE bulk through-
  table `bulk_create(ignore_conflicts=True)` — re-querying per
  hashtag previously made this phase the slowest part of sync.
- First non-star hashtag → `match_task_list` (exact → 4-prefix →
  3-prefix) → `move_task_to_list`.
- `#star`, `#starred`, `#start`, `#starr*` = special "star me" keywords:
  `_star_task_at_top` shifts all starred tasks +1 and puts the task at
  `starred_order=1`. `remove_starred_hashtags` strips them from notes
  so periodic reprocessing doesn't re-star.
- The API's sync op auto-runs `process_task_labels` after sync;
  unexpected errors are logged, never surfaced to the sync response.

## Quick notes (`#notes-<path>` markers → `NoteCategory`)

- A `#notes` marker in title or body classifies a task as a note:
  `NOTE_TAG_RE` (hyphen-aware, case-insensitive, trailing
  `(?![a-z0-9_-])` lookahead so `#notebook-x`/`#notesx` don't
  match) runs as a pre-pass inside `process_task_labels`, sets
  `is_note` + `note_category`, and strips the marker text BEFORE
  `extract_hashtags` runs — marker fragments can never reach
  `match_label`, `match_task_list`, or star keywords, which is
  what keeps notes in their original Google list.
- Path rule: `#notes` → uncategorized; `#notes-x` → top-level
  `x`; `#notes-x-y-…` → group `x` + leaf `y-…` (remaining
  segments rejoined, so `-` and `_` are equivalent in leaves).
  `_` joins words inside a segment; `#notes-bible_research` is
  one multi-word dir. Slugs lowercase, separators canonicalized,
  empties collapsed — the regex's segments are `*` not `+`, so
  `#notes--x`/`#notes-abc-`/`#notes-` still match and fold to
  their canonical paths. Unseen paths auto-create `NoteCategory`
  rows (unique `(user, parent, slug)` plus a conditional
  `(user, slug)` constraint for top-level rows — NULL parents
  never equal under the tuple), resolved via ONE prefetched
  `(parent_id, slug)` index — creates are rare.
- The marker is the source of truth: it stays in the stored
  title/body (app-composed writes put it in the body), and
  classification recomputes every run. Category rename/merge/
  delete therefore REWRITES markers in member notes
  (`rename_note_category` / `retarget_note_category` /
  `retag_notes`, each wrapped in `transaction.atomic`) and flags
  them `needs_push` — a typo category collapses permanently, in
  Google too. `_collapse_marker_whitespace` only folds HORIZONTAL
  whitespace per line — a `\s+` collapse would flatten
  multi-paragraph bodies on every retag/PATCH.
- `/api/notes/` (`notes_api.py`): dashboard (`?category&q&order`),
  note create (delegates to `create_task_view` with a composed
  marker appended to the body via a `request._body` swap) and
  PATCH update (marker rewrite + `needs_push`, implemented
  inline — the delegated view is `@require_POST` and can't serve
  PATCH). Category create/rename/merge/delete routes live BEFORE
  `/{task_id}/` — ninja matches in registration order and
  `categories` would bind as a task id. Star/complete/delete/
  archive/restore on a note reuse the `/api/tasks/task/{id}/…`
  endpoints; archive/trash views stay unified.
- Task views exclude notes: `is_note=False` on dashboard,
  starred, overdue, search, stats (and their label-count bases).
- The notes SPA mounts at root-level `/notes/` in
  `django_apps/urls.py` (`react_app(entry='notes')` + catch-all),
  `SPA_BASES['notes']` covers `/api/notes/*` → `/notes/` for the
  post-auth `next` map.

## Views & API (post-cutover)

- The UI is the React SPA (`frontend/src/tasks/`, Vite entry `tasks`)
  served by `react_app` at `/tasks/` + a `<path:subpath>` catch-all.
  `/tasks/app/*` 301-redirects to `/tasks/*` (legacy strangler mount);
  non-GET/HEAD requests under `/tasks/` 404 — the old template views
  and their POST URLs are gone.
- All reads/mutations are the django-ninja router in `api.py`
  (`/api/tasks/…`). Mutation **operations delegate to the JSON
  handlers still defined in views.py** (`sync_view`,
  `toggle_star`, `complete_task_view`, `reorder_*`, `*_divider`,
  `archive/unarchive/delete/restore/permanent_delete`, `create`/
  `update_task_view`, `process_labels*`, `update_label_view`) so
  semantics — service
  calls, `{'success': …}` shapes, session-stored OAuth state — stay
  identical; `api.py`'s `_adapt()` maps reauth/error payloads onto
  the API contract. Keep those handlers' decorators and bodies in
  sync with the API schemas when contracts change.
- `get_creds_dict(user)` bridges DB credentials → the legacy dict
  shape services expect. The API equivalent of the old
  `reauth_redirect` is `_creds_or_reauth` → `GoogleReauthRequired`
  → 401 `{error: google_reauth, authorization_url}` — the SPA
  navigates to the OAuth flow itself.
- `reverse('google_tasks:dashboard')` resolves to `/tasks/` — kept
  for `home.html` and the `google_api` OAuth-callback default.
- Client-side undo/redo lives in `frontend/src/tasks/actionHistory.ts`
  (localStorage, 50-action cap).
