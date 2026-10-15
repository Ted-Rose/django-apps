# Tasks Productivity Stats — Completed Tasks Dashboard

## Goal

Add a "Stats" page to the tasks SPA (`/tasks/stats`) so the user can see
how many tasks they finish per week and per month, broken down by label
and by Google task list — a productivity dashboard built entirely on the
local mirror of Google Tasks.

## Why this shape

- `GoogleTask.completed` is already populated for every completed task:
  set from Google's `completed` RFC3339 timestamp during sync
  (`_write_remote_tasks`) and stamped `timezone.now()` by
  `services.complete_task` for local completions. Sync pulls
  `showCompleted=True, showHidden=True`, so the local DB is a complete
  history — **no Google API calls needed**, the page is a pure DB read.
- Recurring tasks spawn a new row per occurrence, so each finished
  occurrence naturally counts once — correct for a productivity metric.
- Labels are M2M (`GoogleTask.labels` → `TaskLabel`), so a task can
  carry several labels. Stats count a task **once per label**; per-label
  totals therefore do not sum to the task total. Tasks with no labels
  go into an explicit "Unlabeled" bucket.

## Backend — `GET /api/tasks/stats/`

Implemented directly in `google_tasks/api.py` (read endpoint — reads
never delegate to views.py). Call `_creds_or_reauth(request)` first for
parity with every other read op: dead creds → `401 google_reauth`, and
`spa_url_for` maps `/api/tasks/stats/` → `/tasks/stats/` for `next`.

Query params (all optional, `Query(...)`):

- `weeks: int = 12` — how many ISO weeks (Mon-start) to return,
  bounded 1–52.
- `months: int = 12` — how many calendar months to return,
  bounded 1–36.
- `list: Optional[str]` — `list_id` filter, mirrors the dashboard's
  `list` param so filtered stats stay bookmarkable.

Base queryset:

```python
GoogleTask.objects.filter(
    user=request.user, status='completed', is_deleted=False
)
```

- `is_deleted=False` excludes trash **and** superseded recurring
  occurrences (ghost cleanup marks them `is_deleted`).
- Archived completed tasks **are** included — finishing a task counts
  regardless of later archiving.
- Dividers can never be `status='completed'` (`complete_task` refuses),
  but filter `is_divider=False` defensively anyway.
- `completed IS NULL` rows (completed before the field existed, or
  Google never sent a timestamp) are counted in `summary.unknown_date`
  and excluded from dated buckets — never silently bucketed by
  `updated`.

Aggregation (ORM, portable across Postgres + sqlite test DB):

- Weekly: `qs.exclude(completed=None).annotate(b=TruncWeek('completed'))
  .values('b').annotate(n=Count('pk'))`
- Monthly: same with `TruncMonth`.
- Per-label per-bucket: `.values('b', 'labels__name').annotate(...)` —
  the M2M LEFT JOIN gives one row per (bucket, label); tasks with no
  labels land in the `labels__name=None` group → "unlabeled".
- Per-list per-bucket: `.values('b', 'task_list__title').annotate(...)`.
- `TIME_ZONE = 'UTC'` — TruncWeek/TruncMonth handle tz; document that
  buckets are UTC weeks/months.

Response schema (new in api.py):

```python
class StatsLabelOut(Schema):      # legend + colors
    id: int
    name: str
    color: str

class StatsBucketOut(Schema):
    start: date                   # bucket start (Mon / 1st of month)
    total: int                    # distinct tasks completed in bucket
    by_label: dict[str, int]      # label name → count (sums ≥ total)
    unlabeled: int
    by_list: dict[str, int]       # list title → count

class StatsSummaryOut(Schema):
    this_week: int
    last_week: int
    this_month: int
    last_month: int
    all_time: int
    unknown_date: int

class StatsOut(Schema):
    labels: List[StatsLabelOut]
    weekly: List[StatsBucketOut]    # chronological, zero-filled
    monthly: List[StatsBucketOut]   # chronological, zero-filled
    summary: StatsSummaryOut
```

Zero-fill buckets server-side over the requested window (including the
current, possibly partial, week/month) so the frontend charts render
uniform bars with no gap logic.

## Frontend — `frontend/src/tasks/`

- `routes/Stats.tsx` — standalone page in the `Archived.tsx`/`Search.tsx`
  shape: own minimal navbar (brand link + back-to-dashboard button +
  burger menu), `Toasts`, `ErrorState`/`LoadingSkeleton` reuse from
  `TaskListPage`. Query key `['stats', {weeks, months, list}]` — its own
  root (not `['dashboard']`, which mutations patch as `DashboardOut`).
- `App.tsx` — add `<Route path="/stats" element={<Stats />} />`.
- `api.ts` — `StatsOut`/`StatsBucketOut` type aliases from
  `api-types.ts` + `fetchStats(params)`.
- UI (Bootstrap + CSS only — **no chart library**, keep zero new deps):
  - Summary cards: This week / Last week (+ delta), This month /
    Last month, All-time total.
  - Weekly chart: one bar per week, height ∝ total, **stacked segments
    colored by label** (unlabeled = grey), `title=` tooltips; current
    week visually marked.
  - Monthly chart: same component, monthly series.
  - Per-label table: color badge, total, share — makes the multi-label
    double-counting explicit (note under the table).
  - Per-list breakdown: totals per Google task list.
- `components/TaskNavBar.tsx` — add a "Stats" item (`bi-bar-chart`
  icon) to the view dropdown after Trash + divider, `to="/stats"`.
- i18n: new `stats.*` section in `locales/en.json` + `lv.json`
  (`initI18n('tasks', …)` already bundles both).
- `mutations.ts` — `useCompleteTask`/`useUncompleteTask` also invalidate
  `['stats']` so completions reflect on the stats page on next visit.

## Plumbing

- Regenerate OpenAPI + TS types (CI diffs them):
  `python manage.py export_openapi_schema --output frontend/openapi.json`
  + trailing newline, then `npm run gen:types --prefix frontend`
  (the `tasks` entry is already in the loop).
- Bump `PWA_CACHE_VERSION` in `django_apps/views.py` (21 → 22).
- `frontend/tests/e2e/tasks.smoke.spec.ts` — extend the unauthenticated
  block: `/tasks/stats` 302s to login, `/api/tasks/stats/` 401s.

## Tests

- `google_tasks/test_api.py` (new `StatsApiTests` class, `make_task`
  helpers):
  - unauthenticated GET → 401 `{error: unauthenticated, login_url}`
  - per-user isolation (bob's completions invisible to alice)
  - week/month bucket correctness with pinned `completed` datetimes
    (incl. a task crossing a week boundary)
  - multi-label task counted once per label; unlabeled bucket
  - `is_deleted`, `is_divider` excluded; archived included
  - `completed=None` → `unknown_date`, absent from buckets
  - zero-filled empty weeks; `weeks`/`months` param caps
- `frontend/src/tasks/routes/Stats.test.tsx` — Vitest + RTL: mock
  `fetchStats`, assert summary cards + bar rendering + label legend.

## Out of scope / decisions

- No new npm or pip dependencies (CSS bars, not a chart lib).
- No model changes, no migrations.
- No client-side label multi-select in v1 — the per-label breakdown is
  already the answer to "grouping by type"; `list` filter only.
- Stats are UTC-bucketed (project `TIME_ZONE`); per-user timezones are
  not a concept in this app.

## Verification

```bash
source venv/bin/activate
python manage.py check
python manage.py test google_tasks
npm run typecheck --prefix frontend && npm run lint --prefix frontend
npm test --prefix frontend
python manage.py export_openapi_schema --output frontend/openapi.json \
    && printf '\n' >> frontend/openapi.json \
    && npm run gen:types --prefix frontend && git status --porcelain
npm run build --prefix frontend
```

Manual: `VITE_DEV=1 python manage.py runserver` +
`npm run dev --prefix frontend`, open `http://localhost:8000/tasks/stats`
— cards render, bars show, deep link + navbar dropdown entry work.
