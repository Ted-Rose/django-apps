# Bulk DB writes for the Google Tasks pull sync

## Context

The manual sync (`POST /api/tasks/sync/` → `views.sync_view` →
`sync_all` → `sync_tasks`) times out on Vercel Hobby
(`FUNCTION_INVOCATION_TIMEOUT`, hard cap 300s — cannot be raised on
the free tier). Production logs show ~0.35–0.4s **per task**: the
`Online` list took ~25s for 64 tasks and `Physical` ~65s for 169
tasks, and the run died mid-way at 300s.

The time is not the Google API (1–2 paged `tasks().list` calls per
list). It is per-task ORM work in the pull loop, where every query
is a round-trip to Aiven Postgres over the public internet.

## Current write paths (as of commit `14da5b1`)

### 1. `sync_task_lists` — `services.py:78-128`

14 `GoogleTaskList.objects.update_or_create(user, list_id, defaults)`
calls — 2 queries each, ~28 queries total. Minor cost; same
treatment applies cheaply (see "Scope").

### 2. Pull loop — `sync_tasks` → `_upsert_remote_task`
(`services.py:315-378`, called from `services.py:495-499`)

Already refactored into two phases: fetch **all** pages of **all**
lists first (so `remote_ids` is complete for recurring-merge and
ghost detection), then upsert each remote item. Per remote item,
`_upsert_remote_task` issues:

| Step | Query | When |
|------|-------|------|
| a. `filter(task_id=...).exists()` | 1 SELECT | always |
| b. recurring-candidate query | 1 SELECT | remote id unknown |
| c. merge → `task.save()` | 1 UPDATE (full row) | exactly 1 candidate |
| d. `update_or_create` → `get` | 1 SELECT | no/ambiguous candidate |
| e. `update_or_create` → `save()` | 1 INSERT **or** 1 UPDATE (full row) | always in branch d |
| f. `created` fixup `save()` | 1 UPDATE | created && `created` null |

So **2–4 queries per remote task**, several of them full-row
`save()`s, and the branch-b query carries
`exclude(task_id__in=remote_ids)` — a `NOT IN` clause with *every*
remote id across all lists (hundreds of params, re-sent per task).

With ~300+ remote tasks this is ~900–1200 WAN round-trips ⇒ the
observed 300s+.

### 3. `_trash_ghost_tasks` (`services.py:381-412`)

Already set-based: one `UPDATE ... WHERE title__in=remote_titles AND
task_id NOT IN remote_ids` per list. Fine as-is; only ordering
matters (see Risks).

### 4. `push_local_changes` (`services.py:131-312`)

Per-task `patch`/`insert`/`delete` API calls — but bounded by
`needs_push=True` rows (typically 0–a few). **Out of scope.**

## Proposed design

Keep the existing two-phase structure (fetch-all-then-write is
required by the recurring logic). Change phase 2 from per-item ORM
calls to **classify in memory → flush in bulk**:

```
pulls = fetch all pages of all lists          # unchanged
remote_ids = {...}                            # unchanged

local_tasks = list(GoogleTask.objects.filter(user=user))   # 1 query
by_task_id = {t.task_id: t for t in local_tasks}
candidates = index of local rows for recurring merge:
             {(task_list_id, title): [tasks]}  filtered to
             status='needsAction', is_deleted=False,
             is_divider=False, task_id not in remote_ids

to_create, to_update = [], []
sync_time = timezone.now()

for task_list, remote_items in pulls:
    for task_data in remote_items:
        defaults = {...same as today, incl. task_list, last_synced_at}
        if task_data['id'] in by_task_id:
            mutate row in memory with defaults       -> to_update
        elif exactly one recurring candidate:
            mutate candidate (incl. task_id rewrite,
            created=sync_time)                       -> to_update
        else:
            build GoogleTask(...)                    -> to_create

bulk_create(to_create, ...)                    # ~1 query / 500 rows
bulk_update(to_update, fields=[...])           # ~1 query / 500 rows
for task_list, remote_items in pulls:
    _trash_ghost_tasks(...)                    # unchanged, 1 query/list
```

Per-list result: ~3–5 queries regardless of task count. Expected
pull phase: ~900 queries → ~45; `Physical` 169 tasks: ~65s → ~2s.

## Per create/update path, analyzed

### A. Known remote id → update (the common case)

- Today: `exists()` SELECT + `get` SELECT + full-row `save()` UPDATE
  (re-writes *every* column incl. local-only ones with stale
  in-memory values).
- Proposed: in-memory lookup + `bulk_update`.
- **Field list for `bulk_update`** — must mirror `defaults` plus
  housekeeping:
  `['task_id', 'task_list', 'title', 'notes', 'due_date', 'status',
    'completed', 'updated', 'last_synced_at', 'created',
    'updated_at']`
  - `task_id`: needed so the merge path (B) can rewrite it in the
    same call; harmless for normal rows (same value).
  - `task_list`: a remote list-move must follow the row (defaults
    sets it unconditionally today — preserve).
  - `created`: merged rows get `created=sync_time` (today's merge
    path does this); normal updates rewrite the identical value —
    harmless.
  - `updated_at`: `auto_now` is **not** bumped by `bulk_update`
    unless listed explicitly — set `row.updated_at = sync_time` in
    memory to keep `save()` semantics. (Nothing currently reads
    `updated_at`, but keep it correct.)
- **Excluded on purpose** (local-only, never touched today either):
  `needs_push`, `is_starred`, `is_divider`, `task_order`,
  `starred_order`, `is_archived`, `is_deleted`, `deleted_at`,
  `labels` (M2M — can't be bulk-written anyway). Note this is
  *strictly narrower* than today's full-row `save()`, so bulk is
  actually less clobber-prone, not more.

### B. Unknown remote id → recurring-merge → update

- Today: candidates query + full-row `save()` incl. `task_id`
  rewrite + `created`.
- Proposed: same row mutated in memory, lands in `to_update`.
- **Fidelity requirements** (the risky part — see Risks):
  - Candidate set must equal the ORM filter exactly:
    `user`, `task_list=task_list`, `title=<remote title or
    'Untitled'>`, `status='needsAction'`, `is_deleted=False`,
    `is_divider=False`, `task_id NOT IN remote_ids`.
  - Evaluate `task_id not in remote_ids` **at consume time on the
    live object**, not when building the index: after a merge the
    row's `task_id` becomes a remote id and must stop being a
    candidate for later same-title items (serial code sees this via
    re-querying; the in-memory version must mirror it by mutating
    the shared object and re-filtering).
  - Consume candidates in pull order; exactly-one → merge, zero or
    many → create.
- `RecurringTaskSyncTests` (`tests.py:726+`) is the regression suite
  for this — must stay green untouched.

### C. Unknown remote id → create

- Today: `update_or_create` SELECT + INSERT + occasional `created`
  fixup UPDATE.
- Proposed: `GoogleTask(user=user, task_id=..., created=sync_time,
  **defaults)` → `bulk_create`.
- `created` is `null=True` with no default — today's fixup exists
  precisely because `update_or_create` leaves it null; setting it
  in the constructor makes the fixup unnecessary. Keep setting it
  explicitly (don't rely on `auto_now_add` — the field isn't one).
- Default `task_order=get_unix_timestamp` is a Python-side default —
  applied normally for `bulk_create`. New remote tasks keep landing
  at "now" positions, same as today.

### D. Ghost cleanup

- Keep `_trash_ghost_tasks` per list, unchanged — **but run it after
  the bulk flush**, not interleaved per list. See Risks.

### E. Task-list rows (optional, same helper)

- Load existing `GoogleTaskList` rows once, split create/update,
  bulk both. 14 rows — saves ~25 queries; do it only if the helper
  generalizes cleanly, otherwise leave `update_or_create`.

## Risks & mitigations

### R1. Unique-violation race on `bulk_create` (highest practical risk)

`task_id` is `unique=True`. Two overlapping syncs (double-clicked
sync button, Vercel + Cloud Run deployments serving different
clients, browser retry) can both decide "create" for the same remote
id → `IntegrityError` on the whole batch. Today `update_or_create`'s
internal retry confines the fallout to one row.

Mitigations, pick one:

- **`bulk_create(update_conflicts=True, unique_fields=['task_id'],
  update_fields=[...])`** — single-statement upsert; on conflict it
  updates, on insert it uses constructor values. Put `created` in
  the constructor but **not** in `update_fields` so an existing
  row's `created` survives. Supported on PostgreSQL; verify the
  sqlite test DB accepts it (Django 4.2 supports it there) — tests
  run on sqlite so a failure will show immediately.
  Caveat: merges (path B) can't go through this since they update a
  *different* PK — they stay in `to_update`.
- Or `ignore_conflicts=True` — conflicting rows keep old column
  values until next sync; must then *not* also place them in
  `to_update` (they may not exist locally yet — actually they do:
  the conflict means a row exists, so adding them to `to_update`
  after the failed-insert resolution is correct and heals the row
  in the same sync). Slightly more code, no upsert dependency.
- Or catch `IntegrityError` and replay that batch row-by-row via
  `update_or_create` — most faithful to today's behavior, dead
  simple, only pays the slow path when a race actually happens.

Recommendation: `update_conflicts` if sqlite accepts it, else the
IntegrityError→per-row fallback.

### R2. Recurring-merge fidelity

The candidate selection is the subtlest logic to port from ORM to
in-memory (exact-title match, open-only, consume-time `remote_ids`
check, order of consumption). Get this wrong and recurring series
either duplicate or merge into the wrong row. Mitigation: the
existing `RecurringTaskSyncTests` cover merge, ambiguous, completed,
cross-list and ghost cases — they must pass unmodified; add one
test for two same-title unknown items in one pull if missing.

### R3. Write-before-ghost ordering

`_trash_ghost_tasks` reads DB state: a merged row must already carry
its **new** `task_id` or it will look like a ghost (its old id is
not in `remote_ids`, its new title *is* in `remote_titles`) and be
trashed. Today the per-item `save()` flushes before the ghost query
runs — preserve that: run `bulk_create`/`bulk_update` **first**,
then the per-list ghost updates. Same ordering, same semantics.

### R4. `bulk_update` doesn't touch `auto_now`

`updated_at` silently stops advancing for synced rows unless listed
in `fields` with an explicit value. Easy to miss because nothing
fails. Include it (see field list) + a test asserting it advances.

### R5. Signals / `save()` bypass

No signals or `save()` overrides exist today (verified) — safe. Add
a short code comment that sync writes bypass `save()` so a future
override doesn't silently not-run during sync.

### R6. Statement size / batching

`bulk_update` emits one `UPDATE ... CASE` per batch; ~300 rows × 11
fields is fine on Postgres, but pass `batch_size=500` to both calls
for headroom (and it keeps parameter counts under SQLite's limits
in tests).

### R7. Memory / snapshot consistency

Loading all of a user's tasks (~hundreds of rows) is trivial. The
snapshot semantics actually *improve*: today each row is read at a
different moment mid-loop; the batch reads one consistent snapshot.
A concurrent edit in the fetch window lands in the same race window
that already exists today — and loses *less* than before, since
`bulk_update` writes only remote-mirrored fields and can't touch
`needs_push` (today's full-row `save()` can clobber it).

### R8. `total_synced` counting

Keep counting remote items processed (not rows written) — the log
lines and `Synced N tasks from <list>` output stay comparable with
previous logs.

## Alternatives considered

- **`update_conflicts` for everything** (one query instead of
  create+update): rejected for the *whole* set because merge rows
  update a different PK and can't go through upsert — but it is the
  recommended conflict strategy for `to_create` (R1).
- **Threads (`ThreadPoolExecutor`)**: parallel Google API + DB calls
  would help without code restructuring, but keeps O(n) queries,
  complicates the recurring logic's shared state, and Django
  connection handling per-thread adds failure modes. Bulk removes
  the need.
- **Per-item `update_or_create` on Cloud Run instead of Vercel**:
  sidesteps the cap rather than fixing the cause; also fine as a
  *complement* but bulk should land first since Cloud Run would
  still burn ~5min of request time.

## Test plan

Run against sqlite per repo rules (`python manage.py test
google_tasks`).

1. **Regression**: `RecurringTaskSyncTests` (merge into open row,
   completed local → create, ambiguous → create, cross-list move,
   ghost trashing) — must pass unmodified.
2. **Query count**: new test — seed a list with 150 remote items
   (mix of existing/changed/new) and `assertNumQueries` is bounded
   by a small constant (~≤10) rather than O(n).
3. **`updated_at`** advances for updated rows; **`created`** set on
   insert and on merge, preserved (not nulled/overwritten) on
   ordinary update.
4. **Local-only fields survive**: star/labels/orders/is_deleted on
   updated and merged rows (partially covered by existing merge
   test — extend if a field is untested).
5. **Conflict path**: simulate the race (pre-insert a row with a
   remote `task_id` between classification and flush — e.g. via a
   `bulk_create` wrapper mock or a second sync) → no 500, row ends
   up with remote values.
6. **Push path untouched**: existing push tests keep passing.

## Expected outcome

| Stage | Now | After |
|-------|-----|-------|
| DB queries, pull of ~300 tasks | ~900–1200 | ~50 |
| `Physical` list (169 tasks) | ~65s | ~2s |
| Full `sync_all` | 300s+ (timeout) | ~15–30s, API-bound |

Leaves comfortable headroom inside the 300s cap and makes the later
`updatedMin` delta-sync a nice-to-have rather than a necessity.

## Out of scope (deliberate follow-ups)

- `updatedMin` delta pull + `showDeleted=True` (also fixes missed
  remote deletions — a correctness bug today).
- `completedMin` to bound completed-history growth.
- `process_task_labels` restricting to changed tasks (runs in the
  same request after sync).
- Moving sync to a Cloud Run job / scheduled sync.
- `push_local_changes` batching (bounded by `needs_push` — small).
