# Spec Delta

## Purpose

Turns `#notes-…`-tagged Google Tasks into a first-class notes
workspace: hashtag-driven classification into an auto-created
category tree, a `/notes/` SPA for browsing and writing notes,
and strict separation from the tasks UI.

## ADDED Requirements

### Requirement: Note classification via `#notes` markers

A task SHALL be classified as a note when its title or notes
field contains a `#notes` marker — `#notes` alone or followed by
hyphen-separated path segments — matched case-insensitively by a
dedicated hyphen-aware pattern (the shared hashtag regex splits
on hyphens and MUST NOT be used for marker detection).
Classification SHALL be recomputed on every label-processing
run.

#### Scenario: Marker in title classifies the task as a note

- **WHEN** a task's title contains `#notes-household`
- **THEN** the task is classified as a note

#### Scenario: Marker matching is case-insensitive

- **WHEN** a task's notes field contains `#Notes-God-Prayer`
- **THEN** the task is classified as a note

#### Scenario: Removing the marker unclassifies the task

- **WHEN** a task previously classified as a note no longer
  contains a `#notes` marker and processing runs again
- **THEN** it is treated as a normal task and its category
  assignment is cleared

#### Scenario: First marker wins

- **WHEN** a task contains several `#notes-…` markers
- **THEN** the first marker determines its category path

### Requirement: Note markers are isolated from hashtag processing

Text matched by the notes pattern SHALL be removed before the
shared hashtag extraction runs, so marker fragments can never
trigger label matching, unmatched-tag warnings, list moves, or
star keywords. Hashtags outside the marker SHALL be processed
normally.

#### Scenario: Marker fragments produce no side effects

- **WHEN** a task contains `#notes-projects-django-apps`
- **THEN** the fragments `notes`, `projects`, `django`, and
  `apps` cause no label matches, no unmatched-tag warnings, and
  no list move

#### Scenario: Other hashtags on a note still process

- **WHEN** a task contains `#notes-god-prayer #church`
- **THEN** `church` is processed as a normal hashtag

#### Scenario: Star keyword inside a marker does not star

- **WHEN** a task contains `#notes-star-journal` and no other
  star keyword
- **THEN** the task is not starred

### Requirement: Category paths resolve to a nested tree

The marker's path SHALL resolve as: `#notes` → uncategorized;
`#notes-x` → top-level category `x`; `#notes-x-y-z-…` → a
nested chain of arbitrary depth, one hyphen-separated segment
per level. An underscore is the ONLY word-joiner inside a
segment and renders as a space. Segment slugs SHALL be
lowercase, keep underscores (so a composed marker re-parses
identically), canonicalize separators, and collapse empties.
Missing categories SHALL be auto-created for the owning user
on first sight.

#### Scenario: Multi-segment marker resolves nested dirs

- **WHEN** a task carries
  `#notes-projects-World_of_Bible-Easter_eggs`
- **THEN** it is filed under `projects` → "World Of Bible" →
  "Easter Eggs" (three levels)

#### Scenario: Hyphens alone always mean more depth

- **WHEN** a task carries `#notes-projects-django-apps`
- **THEN** it is filed under `projects` → `django` → `apps`

#### Scenario: Underscore keeps a multi-word name atomic

- **WHEN** one task carries `#notes-projects-django_apps` and
  another `#notes-projects-django-apps`
- **THEN** the first lands in a single `django_apps` leaf
  ("Django Apps") while the second nests `django` → `apps`

#### Scenario: Bare marker files as uncategorized

- **WHEN** a task carries `#notes` with no segments
- **THEN** it appears in the uncategorized notes bucket

#### Scenario: Underscore makes a multi-word top-level dir

- **WHEN** a task carries `#notes-bible_research-genesis`
- **THEN** it is filed under group `bible_research` (displayed
  "Bible Research"), leaf `genesis`

#### Scenario: New path auto-creates categories

- **WHEN** a marker names a path with no existing categories
- **THEN** the missing category nodes are created for that user

#### Scenario: Existing path is reused

- **WHEN** a marker resolves to an already-existing path
- **THEN** no duplicate category is created

### Requirement: Notes stay synced tasks in their original list

Notes SHALL remain ordinary Google Tasks: classification never
moves them between lists, edits push to Google like any task,
and a remote pull SHALL NOT clear the note flag or category
assignment.

#### Scenario: Note edits push upstream

- **WHEN** a note's title or body is edited locally
- **THEN** it is marked for push and syncs to Google

#### Scenario: Pull preserves note classification

- **WHEN** sync pulls remote state for a note task
- **THEN** its note flag and category assignment are unchanged

### Requirement: Task and note views are separate

Task-facing views SHALL exclude notes: dashboard, starred,
overdue, search, and stats. The notes surface SHALL list only
notes. Archive and trash views remain unified across both.

#### Scenario: Dashboard hides notes

- **WHEN** a user opens the tasks dashboard
- **THEN** no notes appear in any task list

#### Scenario: Notes surface lists only notes

- **WHEN** a user opens the notes view
- **THEN** only tasks classified as notes appear

#### Scenario: Trashed note stays in unified trash

- **WHEN** a note is moved to trash
- **THEN** it appears in the shared trash view and is
  restorable

#### Scenario: Note completed in Google stays a note

- **WHEN** a note's remote status becomes completed
- **THEN** it remains a note and appears in the notes surface's
  completed section, never in task views

### Requirement: Category management retags member notes

Renaming, merging, or deleting a category SHALL rewrite the
`#notes-…` marker wherever it appears in every member note's
title or notes field and mark those notes for push — the marker
remains the durable source of truth. Deleting SHALL move member
notes to a chosen target category or uncategorized.

#### Scenario: Rename rewrites markers

- **WHEN** category `praer` is renamed to `prayer`
- **THEN** every member note's marker is rewritten to the new
  path and the notes are marked for push

#### Scenario: Merge folds one category into another

- **WHEN** category `django-app` is merged into `django-apps`
- **THEN** members are retagged to `django-apps` and the empty
  source category is removed

#### Scenario: Delete uncategorizes members

- **WHEN** a category is deleted with uncategorized as target
- **THEN** member markers collapse to bare `#notes`

### Requirement: Notes API surface

The `/api/notes/` router SHALL expose a notes dashboard
(category filter, search, ordering), category CRUD plus merge,
and note create/update. Create/update SHALL manage the marker
on the caller's behalf — clients send a category id, never raw
markers. Every query SHALL be per-user scoped.

#### Scenario: Note creation injects the marker

- **WHEN** a note is created with category `god/prayer`
- **THEN** the stored task carries a `#notes-god-prayer` marker
  and is classified immediately

#### Scenario: Category change rewrites the marker

- **WHEN** a note's category is changed via the API
- **THEN** its marker is rewritten and `needs_push` is set

#### Scenario: Another user's category id is invisible

- **WHEN** a request references a category owned by another
  user
- **THEN** the response is 404

### Requirement: Notes SPA surface

A `notes` SPA SHALL be served at `/notes/` providing a category
tree navigator, a note list with a completed-notes section, a
full-page note editor (title, body, category picker), and a
category management page. Rendered note titles SHALL hide the
`#notes-…` marker.

#### Scenario: Deep link renders the notes shell

- **WHEN** a user opens `/notes/category/<id>/`
- **THEN** the SPA shell renders and the category view loads

#### Scenario: Marker is hidden in displayed titles

- **WHEN** a note titled `Prayer list #notes-god-prayer`
  renders
- **THEN** the UI shows `Prayer list` without the marker
