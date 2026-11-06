# Design

## Context

Every tasks section page already persists
`window.location.pathname + search` to `localStorage`
(`lastTasksView`) on render/param change — `TaskListPage`
(dashboard, starred, overdue), `Archived`, `Trash`, `Stats`,
`Labels`. `Search` and `TaskDetail` deliberately do not (the
detail page writes `taskListReferrer` instead), so the stored
value always names a restorable section. The existing
`spaPathFromStoredUrl()` helper in `frontend/src/tasks/utils.ts`
already converts stored absolute paths — including legacy
`/tasks/app/…` ones — into router-relative `to` values, returning
`null` for non-SPA paths. Today nothing consumes the key at app
load; see proposal.md for motivation.

## Goals / Non-Goals

**Goals:**

- A fresh tasks SPA mount on the bare dashboard route restores
  the recorded section (path + filters) via client-side
  navigation, without a full reload.
- Deep links and filtered dashboard URLs behave exactly as
  today.
- The recorded value is read before any page on this mount can
  overwrite it.

**Non-Goals:**

- Changing `start_url`/`scope` in the PWA manifest or teaching
  `home.html` to redirect — relaunch lands on home as today and
  the restore happens when `/tasks/` loads.
- Restoring `/search` results or a `/task/<id>` detail page —
  those are not "sections" and intentionally never write
  `lastTasksView`.
- Per-user namespacing of the localStorage key (single-user
  tool; the value is a route path, not user data).
- Backend/API/i18n changes.

## Decisions

### Restore at the router host, before Routes resolve

In `App.tsx` (already inside `BrowserRouter`), capture the
restore target in a `useState` initializer:

- Skip unless `location.pathname === '/'` and
  `location.search` is empty — everything else is an explicit
  deep link.
- Read `localStorage.lastTasksView` inside a try/catch (storage
  can throw in private modes — same pattern as the existing
  writers).
- Resolve via `spaPathFromStoredUrl()`; a `null` or a plain `/`
  result means "nothing to restore".

When a target exists, render `<Navigate to={target} replace />`
in place of `<Routes>`.

**Why the initializer, not an effect:** child route effects run
before parent effects, so a `TaskListPage` mounted at `/` would
rewrite `lastTasksView` to `/tasks/` before a parent `useEffect`
could read it. The `useState` initializer runs during App's
render — strictly before any child mounts — so the pre-mount
value is guaranteed.

**Why `<Navigate>` over `useEffect(() => navigate())`:** the
dashboard never mounts on a restore, so no wasted
`/api/tasks/dashboard/` fetch, no flash of All Tasks, and no
transient `/tasks/` write into `lastTasksView`. `replace` keeps
the synthetic `/` entry out of history so Back cannot land on
it.

**Alternatives considered:** restoring server-side is
impossible (the key lives only in the browser); a listener on
every `useLocation` change would re-hijack in-session
navigations to `/`, so the check is bound to initial mount
only.

## Risks / Trade-offs

- Stored filter references a since-deleted list or label → the
  section page loads with its existing empty/error handling;
  same as following a stale bookmark today.
- StrictMode dev double-invocation → initializer/effects are
  idempotent; `Navigate` is render-declared, safe.
- A user who explicitly wants All Tasks on every launch has no
  opt-out → acceptable; selecting All Tasks in the dropdown is
  one tap and persists as `/` anyway.
