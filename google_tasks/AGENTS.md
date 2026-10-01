# google_tasks — Agent Guide

Largest app in the project: a Google Tasks client with bidirectional
sync and several local-only features. Full behavior docs:
`README.md` in this directory.

## Sync model (services.py)

`sync_all(user, creds)` → `sync_task_lists` + `sync_tasks`, where
`sync_tasks` first runs `push_local_changes` (push tasks with
`needs_push=True`) then pulls remote state via `update_or_create` on
`(user, task_id)`.

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
`is_archived`, `is_deleted`, `deleted_at`, `labels` (M2M `TaskLabel`).

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
- First non-star hashtag → `match_task_list` (exact → 4-prefix →
  3-prefix) → `move_task_to_list`.
- `#star`, `#starred`, `#start`, `#starr*` = special "star me" keywords:
  `_star_task_at_top` shifts all starred tasks +1 and puts the task at
  `starred_order=1`. `remove_starred_hashtags` strips them from notes
  so periodic reprocessing doesn't re-star.
- The API's sync op auto-runs `process_task_labels` after sync;
  unexpected errors are logged, never surfaced to the sync response.

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
  `update_task_view`, `process_labels*`) so semantics — service
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
