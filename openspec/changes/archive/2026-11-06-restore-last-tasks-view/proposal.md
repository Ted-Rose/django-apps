# Proposal

## Why

Every tasks SPA section already writes its URL to
`localStorage.lastTasksView` (dashboard/starred/overdue via
`TaskListPage`, plus archived, trash, stats, labels), but nothing
ever reads it back on load — it only feeds "back to dashboard"
links in Stats/Labels/Search. When the user closes the PWA and
reopens it, the app always lands on the All Tasks dashboard
instead of the section they were last viewing.

## What Changes

- On a fresh tasks SPA mount, when the landing route is the bare
  dashboard (`/` with no query string), read `lastTasksView`,
  resolve it through the existing `spaPathFromStoredUrl()` helper
  (which also maps legacy `/tasks/app/…` paths), and client-side
  navigate to it with `replace` semantics.
- Deep links keep working unchanged: any non-`/` landing path or
  a `/?<params>` URL skips the restore.
- The stored value must be captured during the initial render —
  before child route effects rewrite `lastTasksView` — so a
  bare-`/` mount cannot clobber the section being restored.
- No backend, API, or URL-contract changes; persistence stays in
  `localStorage` under the existing `lastTasksView` key.

## Capabilities

### New Capabilities

- `tasks-view-persistence`: how the tasks SPA remembers the last
  viewed section in `localStorage` (`lastTasksView`, also
  `taskListReferrer` for the detail page) and restores it when
  the app is relaunched onto the bare dashboard route.

### Modified Capabilities

<!-- None — spa-shell covers server-side shell rendering and
     mounts; this change is client-side routing state only. -->

## Impact

- `frontend/src/tasks/App.tsx` (restore-on-mount logic) and its
  test file; `frontend/src/tasks/utils.ts`
  (`spaPathFromStoredUrl`) is reused unchanged.
- No Django, API, or i18n changes; `frontend/openapi.json`
  untouched.
- Behavior change visible to users: reopening the PWA (or any
  fresh visit to `/tasks/`) restores the last-viewed section
  rather than always showing All Tasks.
