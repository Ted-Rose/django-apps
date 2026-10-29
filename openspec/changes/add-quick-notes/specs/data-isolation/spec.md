# Spec Delta

## MODIFIED Requirements

### Requirement: Local-only state is never exposed cross-user

Local-only features layered on mirrored remote objects —
google_tasks stars, labels, dividers, archive/trash state,
manual ordering, note flags (`is_note`), note category
assignments, and `NoteCategory` rows; finance categories,
rules, limits, notifications — SHALL be stored as per-user
rows and filtered per-user like everything else, and SHALL
NOT be pushed to the external provider.

#### Scenario: Local metadata is invisible to other users

- **WHEN** user A stars a task or labels a transaction
- **THEN** that state exists only on user A's rows and never
  leaks into user B's API responses or the provider mirror

#### Scenario: Note classification and categories are per-user

- **WHEN** user A's tasks are classified as notes and filed
  into categories
- **THEN** the flag, the assignment, and the `NoteCategory`
  rows exist only for user A and never appear in another
  user's API responses or auto-created category tree
