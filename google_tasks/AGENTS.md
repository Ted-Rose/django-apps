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
  `LABEL_AUTO_CREATE=False` by default; unmatched hashtags raise
  `UnmatchedHashtagsError` **before any mutation** (pre-pass pattern —
  preserve it).
- First non-star hashtag → `match_task_list` (exact → 4-prefix →
  3-prefix) → `move_task_to_list`.
- `#star`, `#starred`, `#start`, `#starr*` = special "star me" keywords:
  `_star_task_at_top` shifts all starred tasks +1 and puts the task at
  `starred_order=1`. `remove_starred_hashtags` strips them from notes
  so periodic reprocessing doesn't re-star.
- Dashboard auto-runs `process_task_labels` after sync, swallowing all
  errors silently.

## Views (views.py, ~1800 lines)

- `dashboard`, `starred_tasks`, `overdue_tasks`, `archived_tasks`,
  `trash_tasks` share the same template/context machinery; view flags
  (`is_starred_view`, `is_archived_view`, `is_trash_view`,
  `is_overdue_view`) flow to JS via `get_dashboard_js_config` →
  `json_script` → `static/google_tasks/js/dashboard/*.js`.
- `get_creds_dict(user)` bridges DB credentials → the legacy dict shape
  services expect.
- Client-side undo/redo lives in `js/dashboard/action_history.js`
  (localStorage, 50-action cap).
- All mutations are AJAX `POST` + `JsonResponse`; templates are
  Bootstrap 5 partials under `templates/google_tasks/components/`.
