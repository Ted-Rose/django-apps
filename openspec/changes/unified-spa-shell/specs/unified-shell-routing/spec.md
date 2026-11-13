# Spec Delta

## Purpose

Defines the single-React-root routing layer: every app renders
inside one shell document, app-to-app navigation is client-side
with no document reload, per-app code loads as lazy chunks, and a
shared query cache and session bootstrap span all apps.

## ADDED Requirements

### Requirement: Single React root for all apps

All app surfaces SHALL render inside one React root with a single
top-level router. Navigating between apps SHALL be a client-side
route change — no full document reload — and one shared query
client SHALL serve every app so cached data survives cross-app
navigation.

#### Scenario: App-to-app navigation does not reload the document

- **WHEN** a user on `/tasks/` activates a link to `/finance/`
- **THEN** the URL changes and finance renders without a document
  navigation (no new HTML request)

#### Scenario: Query cache survives app switches

- **WHEN** a user navigates tasks → finance → back to tasks
- **THEN** task list data from the first visit is served from the
  shared query cache, revalidating per its stale policy

### Requirement: Per-app lazy chunks

Each app's code SHALL load on demand when its URL prefix is
routed, as its own build chunk; a loading state SHALL render
while a chunk is in flight. App-internal links and routes SHALL
keep working unchanged under the app's existing URL prefix.

#### Scenario: Deep link loads the owning app's chunk

- **WHEN** a user opens `/tasks/trash/` directly
- **THEN** the shell loads the tasks chunk and renders the trash
  page at the correct client route

#### Scenario: Chunk in flight shows a loading state

- **WHEN** an app's chunk is still loading after a navigation
- **THEN** a loading indicator is shown instead of a blank page

### Requirement: Session bootstrap via the me endpoint

At startup the shell SHALL fetch the session bootstrap endpoint
for user context (`username`, `language`, `is_staff`). On a 401
`unauthenticated` response carrying `login_url` the shell SHALL
navigate the browser to that URL with the current page path as
`next`; while the bootstrap is pending the shell SHALL render a
loading state rather than app content.

#### Scenario: Anonymous visitor is redirected to login

- **WHEN** an unauthenticated user opens any shell-served page
- **THEN** after the bootstrap 401 the browser navigates to the
  `login_url` with `next=<current path>`

#### Scenario: Authenticated bootstrap seeds user context

- **WHEN** an authenticated user opens a shell-served page
- **THEN** apps render with the returned `username`, `language`,
  and `is_staff` without an additional round-trip for user info

### Requirement: Home route inside the shell

`/` SHALL serve the shell and render the dashboard inside it:
one entry per app linking client-side to each app surface, plus
an admin link shown only when `is_staff` is true. The home page
SHALL remain publicly viewable like today — anonymous visitors
see the dashboard while app APIs still enforce auth.

#### Scenario: Staff user sees the admin card

- **WHEN** a staff user's bootstrap returns `is_staff: true`
- **THEN** the dashboard renders the admin link among the app
  cards

#### Scenario: Anonymous visitor sees the public dashboard

- **WHEN** an unauthenticated user opens `/`
- **THEN** the dashboard renders its app cards (following a card
  leads to the login redirect on that app's bootstrap 401)

### Requirement: Priority chunk loading

The primary app (finance) SHALL begin loading at shell startup
ahead of other apps; remaining app chunks SHALL be prefetched
during idle time after the initial route renders.

#### Scenario: Finance is ready before the user navigates

- **WHEN** the shell has finished its initial render and the user
  navigates to `/finance/`
- **THEN** the finance chunk is already loaded or in flight, so
  the loading state is skipped or brief
