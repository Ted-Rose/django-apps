# Bidirectional Sync Implementation

## Overview
Implemented bidirectional synchronization between the local database and
Google Tasks API. The app is the source of truth: local changes are
flagged and pushed to Google before pulling remote updates (new tasks
and completion toggles made in Google).

## Changes Made

### 1. Database Schema (`google_tasks/models.py`)
Fields on the `GoogleTask` model:

- **`needs_push`**: Boolean flag set when a Google-relevant field
  (title, notes, due_date, status, is_deleted) is changed locally
  without a confirmed push. Cleared only after a successful push.
- **`last_synced_at`**: Timestamp when we last synced this task with
  Google Tasks (informational)
- **`updated_at`**: `auto_now` timestamp of the last local write
  (informational only, not used for sync decisions)
- **`updated`**: Google's server-side last-modified timestamp, kept for
  ordering, display, and future conflict detection

**Sync Logic**: Tasks where `needs_push=True` are pushed to Google.
App-level changes (starred, archived, ordering, labels) never set the
flag, so they don't trigger Google API calls.

### 2. Push Function (`google_tasks/services.py`)

#### `push_local_changes(user, creds)`
Pushes local task changes to Google Tasks API before pulling.

**Handles**:
- Field changes: pushes `title`, `notes`, `due`, `status` via `patch()`
- Task deletions (`is_deleted=True`): calls `delete_task_google()`
- Tasks missing remotely (404 on patch): recreated via `insert()` with
  a new `task_id` — this is how restored tasks get back to Google
- Skips dividers and archived tasks (app-level only, not synced)

**Process**:
1. Finds tasks with `needs_push=True`
2. For deleted tasks: calls `delete_task_google()`; clears the flag
   only on confirmed success so failed deletes are retried
3. For other tasks: `patch()` with all synced fields, then clears
   `needs_push` and sets `last_synced_at`
4. On 404: recreates the task via `insert()` and updates `task_id`

### 3. Updated `sync_tasks()` Function
1. **Step 1**: Push local changes to Google (via
   `push_local_changes()`)
2. **Step 2**: Pull updates from Google Tasks API via
   `update_or_create()`, setting `last_synced_at` on each synced row.
   `needs_push` is intentionally NOT in the pull defaults, so a task
   whose push failed keeps its flag and is retried on the next sync.

### 4. Where `needs_push` Is Set

- `update_task_view()`: title/notes changed locally (no eager push)
- `toggle_star()`: notes changed; flag cleared if the eager notes
  `patch()` succeeds, stays set on failure
- `restore_task_view()`: always set — the task may have been deleted
  on Google and must be recreated
- `delete_task_view()`: set only if `delete_task_google()` fails, so
  the delete is retried on next sync

`complete_task()` / `uncomplete_task()` / `move_task_to_list()` push
eagerly and leave `needs_push` untouched: they only push status/move,
so any other pending field changes are still pushed by the next sync.

## Sync Scenarios

### Scenario 1: Task Synced, No Local Changes
- `needs_push=False`
- **Result**: NOT pushed to Google

### Scenario 2: Task Modified Locally
- `needs_push=True`
- **Result**: All synced fields pushed to Google on next sync

### Scenario 3: Push Failed (Network/Timeout)
- `needs_push` stays `True`
- **Result**: Retried on next sync; local change is never lost

### Scenario 4: Task Archived / Starred / Reordered
- `needs_push` unchanged (app-level fields don't set it)
- **Result**: NOT pushed — no redundant API calls

### Scenario 5: Task Deleted Locally
- `is_deleted=True`, `needs_push=True` (or `False` if remote delete
  already succeeded)
- **Result**: Deleted from Google Tasks API on next sync if still
  pending

### Scenario 6: Task Restored from Trash
- `is_deleted=False`, `needs_push=True`
- **Result**: `patch()` 404s (deleted remotely) → task recreated via
  `insert()` with a new `task_id`

## Migrations

- `0016_googletask_last_synced_at_googletask_updated_at_and_more.py`:
  adds `last_synced_at` and `updated_at` (nullable)
- `0017_googletask_needs_push_and_more.py`: adds `needs_push`,
  backfills it from the old `updated_at > last_synced_at` dirty
  condition, converts `updated_at` to `auto_now`

## Benefits

1. **App Is Source of Truth**: Local changes are never silently lost;
   the flag survives pulls and failed pushes
2. **No Redundant API Calls**: Only tasks with actual Google-relevant
   changes are pushed — app-level actions don't dirty the flag
3. **Full Field Sync**: Title/notes/due edits now reach Google, not
   just status
4. **Restore Works**: Restored tasks are recreated on Google instead of
   becoming local-only zombies
5. **Simple Semantics**: Explicit flag instead of timestamp comparison;
   `last_synced_at`/`updated_at` remain for auditing

## Testing
- Migration applied successfully (58 pre-existing dirty rows flagged)
- Django system check passes
- No syntax errors in Python code

## Future Enhancements
1. Add conflict resolution for simultaneous edits on multiple devices
   (compare remote `updated` vs stored `updated`)
2. Implement batch push operations for better performance
3. Add sync statistics/logging dashboard
4. Support clearing `due` remotely (Google patch cannot unset it)
