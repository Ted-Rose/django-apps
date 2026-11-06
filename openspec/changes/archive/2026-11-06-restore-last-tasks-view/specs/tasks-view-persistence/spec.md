# Spec Delta

## Purpose

Defines how the tasks SPA remembers which section the user last
viewed in `localStorage` and restores that section when the app
is relaunched onto the bare dashboard route.

## ADDED Requirements

### Requirement: Last-viewed section is persisted

Every section page of the tasks SPA (dashboard, starred,
overdue, archived, trash, stats, labels) SHALL record its
current absolute path and query string under the
`localStorage` key `lastTasksView` whenever the page renders or
its filter parameters change.

#### Scenario: Viewing a section records it

- **WHEN** the user opens or filters a section page (e.g.
  `/tasks/starred`, `/tasks/?list=<id>`)
- **THEN** `lastTasksView` holds that absolute path including
  the query string

#### Scenario: Non-section pages do not record

- **WHEN** the user visits the search page or a task detail
  page
- **THEN** `lastTasksView` is not overwritten (task detail
  tracks its list referrer separately)

### Requirement: Relaunch restores the last section

On a fresh SPA mount whose landing route is the bare dashboard
(`/`, no query string), the SPA SHALL navigate to the view
recorded in `lastTasksView` using history `replace`, resolving
the stored absolute URL to a client route through the same
mapping the back-navigation links use (including legacy
`/tasks/app/…` paths).

#### Scenario: PWA relaunch returns to the section

- **WHEN** `lastTasksView` is `/tasks/starred` and the user
  opens the app at `/tasks/`
- **THEN** the starred section renders and the bare `/` entry is
  replaced in history

#### Scenario: Stored filters are restored too

- **WHEN** `lastTasksView` is `/tasks/?list=<id>`
- **THEN** the dashboard renders with that list filter applied

#### Scenario: Missing or unresolvable stored view

- **WHEN** `lastTasksView` is absent or resolves to a path
  outside the SPA
- **THEN** the bare dashboard renders normally

#### Scenario: Stored view survives the restore mount

- **WHEN** the restore navigation is about to run
- **THEN** the value read is the one recorded before this mount,
  even though a bare-dashboard mount would otherwise overwrite
  `lastTasksView` with `/tasks/`

### Requirement: Deep links take precedence

The restore SHALL apply only when the initial landing route is
the bare dashboard; an explicit section path or a dashboard URL
carrying query parameters lands on the requested view unchanged.

#### Scenario: Direct section link is not hijacked

- **WHEN** `lastTasksView` is `/tasks/starred` and the user
  opens `/tasks/trash` directly
- **THEN** the trash view renders

#### Scenario: Filtered dashboard link is not hijacked

- **WHEN** the user opens `/tasks/?list=<id>` directly
- **THEN** the dashboard renders with that list filter, whatever
  `lastTasksView` holds
