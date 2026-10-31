# Spec Delta

## MODIFIED Requirements

### Requirement: Local state survives re-sync

Local-only fields and rows layered on mirrored objects SHALL
NOT be overwritten or deleted by a remote pull: google_tasks
`is_starred`, `is_divider`, ordering positions, `is_archived`,
`is_deleted`, `deleted_at`, `labels`; finance
`UserTransactionCategory` rows marked `is_manual`,
`excluded_amount`, rules, limits, alerts. Local edits pending
push (`needs_push=True`) SHALL be pushed before the pull
merges remote state.

#### Scenario: Manual category survives transaction sync

- **WHEN** a transaction with an `is_manual` category
  assignment is updated by a sync
- **THEN** the assignment row and its category are untouched

#### Scenario: Recurring-task succession preserves local metadata

- **WHEN** Google spawns a new remote id for the next
  occurrence of a recurring task
- **THEN** sync merges it into the single open same-titled
  local row (rewriting `task_id`) so stars, labels, ordering,
  note classification, and pending edits carry over; ambiguous
  cases create a new row

#### Scenario: Outgoing edits flush before incoming merge

- **WHEN** `sync_tasks` runs for a user with `needs_push` rows
- **THEN** `push_local_changes` pushes those edits to Google
  before remote state is pulled and merged

#### Scenario: Pull never clears note classification

- **WHEN** a remote pull rewrites a note task's title, notes,
  status, or list
- **THEN** `is_note` and `note_category` are untouched

#### Scenario: Bank relink preserves local metadata

- **WHEN** a relinked bank account is reattached to an
  existing `Account` row by IBAN match (the provider reissues
  `account_id` per requisition)
- **THEN** the row's `account_id` and `requisition` are
  rewritten in place so transactions, category assignments,
  shares, limits, alerts and preferences carry over
