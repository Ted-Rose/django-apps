# Tasks

## 1. Restore on fresh mount

- [x] 1.1 frontend: In `frontend/src/tasks/App.tsx`, compute the
  restore target in a `useState` initializer — bare `/` landing
  with empty `location.search` only, `lastTasksView` read under
  try/catch, resolved via `spaPathFromStoredUrl`, `null`/`/`
  means no restore — and render
  `<Navigate to={target} replace />` instead of `<Routes>` when
  set. Verify with `awk 'length > 79' frontend/src/tasks/App.tsx`
  returning nothing.
- [x] 1.2 frontend: Add `frontend/src/tasks/App.test.tsx`
  (MemoryRouter + `initialEntries`, matching the existing route
  test pattern) covering: stored `/tasks/starred` + landing `/`
  renders the starred view; stored `/tasks/?list=x` + landing `/`
  restores the filter; absent/foreign stored value renders the
  dashboard; landing on `/trash` or `/?list=x` is NOT hijacked.
  Verify `npx vitest run src/tasks/App.test.tsx` passes.

## 2. Gates and docs

- [x] 2.1 frontend: Run `npm run lint`, `npm run typecheck`,
  `npm run format:check` and the colocated vitest files touched;
  all green.
- [x] 2.2 frontend: Note the relaunch-restore behavior in
  `google_tasks/AGENTS.md` (Views & API section, next to the
  `lastTasksView`/undo localStorage mentions) and add a
  user-visible line to `docs/changelog.md`.

## Workflow follow-up

- Archive the change (`openspec archive
  restore-last-tasks-view`) in the implementing PR once checks
  are green.
- Manually verify in the built SPA: visit `/tasks/starred`,
  reload `/tasks/`, confirm the starred view renders.
