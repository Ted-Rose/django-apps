# Handling Google recurring tasks in sync

## Problem

Recurring Google Tasks ("check WhatsApp" every week, "Pray for next
week", etc.) accumulate as duplicate rows in `google_tasks.GoogleTask`.

Root cause: Google implements recurrence by creating a **brand new
task entity** (new `id`) for every occurrence instead of exposing one
recurring object. `sync_tasks` in `google_tasks/services.py` does
`update_or_create(user=..., task_id=task_data['id'])`, so each new
occurrence becomes a new local row while the previous row stays
`needsAction` forever.

Production evidence (read-only `ai_agent` inspection, 2026-10-13):

- 10 local `check WhatsApp` rows in `Reminders`: 3 `completed`,
  7 `needsAction`, `due_date` spaced exactly 7 days apart
  (Saturdays 2026-07-11 … 2026-10-10).
- 42 local rows total whose remote `task_id` is missing from
  `tasks().list` output ("ghosts"), across ~10 recurring series —
  including everything in the aptly named `Recurring` list
  ("Pray for next week" ×9, "Auto eļļas…" ×3, …).

## Research: what the Google Tasks API actually sends

Verified empirically via `tasks().list`/`tasks().get` against
production (script threw away the refreshed token, DB untouched):

1. **No recurrence marker exists.** Across all 1085 remote tasks the
   payload only ever contains the standard v1 fields: `kind`, `id`,
   `etag`, `title`, `updated`, `selfLink`, `parent`, `position`,
   `notes`, `status`, `due`, `completed`, `deleted`, `hidden`,
   `links`, `webViewLink`. No `recurrence`, `recurringTaskId`,
   series id, or anything similar. `links` is only used for
   `keep_note` attachments (8 tasks) — unrelated to recurrence.
   `webViewLink` slugs differ per instance too — no stable series id.

2. **Old occurrences are suppressed from `list`, not deleted.**
   `tasks().list` — even with `showCompleted=True, showHidden=True,
   showDeleted=True` — returns only the *current* occurrence of a
   series. Every "ghost" local row's `task_id` still resolves via
   `tasks().get`: it returns `status: needsAction`, its original
   `due`, `links: []`, no `hidden`/`deleted` flags, and
   `position: "00000000002147483647"` (= INT32_MAX, a parking
   position for suppressed instances; the live occurrence sits at a
   real position like `00000000000000000003`). Each suppressed
   instance's `updated` was bumped at the moment the next occurrence
   was generated.

3. **New occurrences appear on schedule, not on completion.** The
   user never completed the open "check WhatsApp" instances, yet a
   new entity was spawned every Saturday (~03:00 UTC): previous
   instance gets its `updated` rewritten and is suppressed from
   `list`, new `needsAction` instance with next `due` is created.
   When a recurring task *is* completed, the completed entity is
   hidden/purged like any completed task and the next instance
   appears the same way.

4. **Same-titled open tasks CAN legitimately coexist remotely**
   (e.g. `Another labeling test` ×5, `Put bedroom lamps` ×3 are all
   returned by `list`). Any dedup heuristic must not merge remote
   tasks that are both still visible.

## Desired behavior (per request)

When sync pulls a task whose `id` is unknown locally but it is the
next occurrence of a series:

- If the corresponding local task is **open** → update that row in
  place: rewrite `task_id` to the new remote id and refresh all
  synced fields, including `created` = time it was fetched.
- If the corresponding local task is **completed or locally
  deleted** → create a new row.

## Detection heuristic

There is no API marker, so a "new remote task is a recurring
successor" is inferred from three facts that are all true only for
recurring succession:

- the remote `id` is not present in the local DB, **and**
- a local row exists in the **same task list** with the **same
  title**, `status='needsAction'`, `is_deleted=False`,
  `is_divider=False`, **and**
- that row's `task_id` is **absent from the current pull's remote
  id set** (its remote entity was suppressed — the signature of a
  superseded occurrence).

Why this is safe:

- Legitimately duplicated remote tasks keep all their ids in the
  `list` output, so their local rows never become merge candidates.
- A task genuinely deleted remotely *and* re-created by hand is
  indistinguishable from recurrence — merging is still the right
  outcome (same title, same list, open task replaced by an open
  task).
- Title is the only viable series key; renaming the task in Google
  breaks the match and the new instance is created separately —
  acceptable degradation.

## Proposed implementation

### 1. Restructure the pull loop (`sync_tasks`)

Today items are `update_or_create`d page-by-page. Detection needs
the *complete* remote id set per list first, so per list:

```python
remote_items = []
page_token = None
while True:
    results = service.tasks().list(...).execute()
    remote_items.extend(results.get('items', []))
    page_token = results.get('nextPageToken')
    if not page_token:
        break

remote_ids = {t['id'] for t in remote_items}
for task_data in remote_items:
    ...update_or_create or merge...
```

### 2. Merge instead of create (`_upsert_remote_task` helper)

For each `task_data` in `remote_items`:

- `GoogleTask` with `(user, task_id)` exists → `update_or_create`
  exactly as today.
- Else → look up merge candidates:

  ```python
  candidates = GoogleTask.objects.filter(
      user=user,
      task_list=task_list,
      title=task_data.get('title', 'Untitled'),
      status='needsAction',
      is_deleted=False,
      is_divider=False,
  ).exclude(task_id__in=remote_ids)
  ```

  - **Exactly 1 candidate** → merge: set `task_id` to the new remote
    id, overwrite the same fields `defaults` sets today (`title`,
    `notes`, `due_date`, `status`, `completed`, `updated`,
    `last_synced_at`), set `created = sync_time` (per request —
    reflects when the occurrence was fetched). Keep every
    local-only field untouched (`is_starred`, `task_order`,
    `starred_order`, `is_archived`, `labels`) — a side benefit:
    stars/labels/ordering now survive recurrence instead of being
    reset on a new row.
    - If the candidate has `needs_push=True`, leave the flag set:
      the pending local edits will be pushed onto the *new* remote
      instance on the next push — desired behavior.
  - **0 or ≥2 candidates** → fall back to normal
    `update_or_create` (create). Ambiguity is resolved toward
    creating rather than risking a wrong merge.
  - Candidates that are `completed` or `is_deleted` are excluded by
    the filter, so a finished/deleted occurrence always yields a
    new row — matching the requested behavior.

- Log each merge at `INFO` (`Recurring task: rewrote <old_id> ->
  <new_id> for '<title>'`) — series merges should be greppable.

### 3. Cleaning up the existing ghosts

Merging fixes the future but leaves today's 42 ghost rows (7 of
them open "check WhatsApp"-style clutter). Options:

- **Recommended — opportunistic cleanup on merge:** when a merge
  succeeds and *additional* same-title open ghosts remain in the
  list, mark them `is_deleted=True, needs_push=True`. Their remote
  entities are the suppressed INT32_MAX-parked instances; the next
  push deletes them remotely — invisible cleanup with real remote
  deletes, consistent with "app is source of truth".
- Safer alternative: `is_archived=True` locally (no remote touch)
  and let the user purge from the trash view.
- Or a one-off management command / admin action to list and
  bulk-trash ghosts. Only needed once if the merge fix ships.

### 4. Tests (`google_tasks/tests.py`)

Mock `service` like the existing sync tests:

- remote returns a new id with title X while the local open X's id
  is absent from the remote page → assert row merged in place:
  `task_id` rewritten, `due_date`/`updated`/`created` refreshed,
  `is_starred`/`task_order` preserved, no new row created.
- same but the local match is `status='completed'` → assert a new
  row is created.
- local match `is_deleted=True` → new row created.
- two same-title open ghosts → no merge, new row created.
- remote contains two same-titled open tasks whose ids both exist
  locally → both update normally, no merge.
- candidate with `needs_push=True` merges and keeps the flag.

## Edge cases & limitations

- Renaming a recurring task's title in Google orphans the series
  match → new row created (documented acceptable).
- If Google ever adds a real recurrence field, this heuristic can
  be replaced/augmented — keep the match logic in one helper.
- Subtasks (`parent` set) are excluded naturally? Not explicitly —
  if a recurring task ever has a parent, `parent` isn't stored
  locally anyway; title+list match still applies. Worth a test
  only if subtasks prove recurring-capable.
- The merge only fires when the old instance vanished from `list`
  in the *same* pull — a task that was merely edited remotely
  keeps its id, so it can never be a false-positive candidate.

## Open questions for the user

1. Ghost cleanup preference: auto-delete (`is_deleted` + remote
   push), auto-archive, or leave for manual cleanup?
2. Should matching also require equal `notes`? Recommendation: no —
   editing notes on the Google side would otherwise split the
   series; title+list is enough given the "remote id absent"
   precondition.
