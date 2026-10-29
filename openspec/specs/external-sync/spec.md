# External Sync Specification

## Purpose

Defines how external provider objects (Google Tasks, GoCardless
bank data, Google OAuth credentials) are mirrored into local
tables: remote-ID-keyed upserts, incremental cursors, failure
isolation, and the rule that local-only state survives re-sync.
The mirror is a cache of remote truth plus a layer of per-user
local state that remote data MUST NOT clobber.

## Requirements

### Requirement: Remote-ID-keyed mirroring

External objects SHALL be upserted keyed on the provider's remote
id — `update_or_create` or the equivalent bulk-upsert (google_tasks
classifies pulls in memory and flushes via `bulk_create` /
`bulk_update` for sync-time performance; same semantics). Remote id
fields: Google Tasks `task_id` / `list_id` (unique per user);
GoCardless `requisition_id` / `account_id` (globally unique) and
`transaction_id` (unique per `(account, transaction_id)`); Google
OAuth credentials keyed per user.

#### Scenario: Re-sync updates rather than duplicates

- **WHEN** a sync pulls a remote object whose id already exists
  locally
- **THEN** the existing row is updated in place — no duplicate is
  created

#### Scenario: Remote items lacking an id get a stable synthetic key

- **WHEN** a GoCardless entry has no `transactionId` (pending and
  other non-booked groups)
- **THEN** sync synthesizes a deterministic `<status>-<digest>`
  id so the same entry reconciles across syncs while it stays in
  that group

### Requirement: Incremental cursors and failure isolation

Finance transaction sync SHALL page forward from `Max(
booking_date)` of *booked* rows per account as `date_from`
(pending value-dates cannot push the cursor and skip real
bookings). Per-account sync failures SHALL be logged and MUST NOT
abort the run for other accounts. Non-booked transaction groups
are snapshots — rows that leave the remote list are deleted
locally.

#### Scenario: One failing account does not block the rest

- **WHEN** a sync run hits a provider error on one account
- **THEN** the failure is logged and remaining accounts still
  sync

#### Scenario: Settled pending row is replaced by the booked row

- **WHEN** a pending entry disappears from the pending group
  after settling
- **THEN** its synthetic-id row is deleted and the booked row
  (real `transactionId`) stands alone

### Requirement: Local state survives re-sync

Local-only fields and rows layered on mirrored objects SHALL NOT
be overwritten or deleted by a remote pull: google_tasks
`is_starred`, `is_divider`, ordering positions, `is_archived`,
`is_deleted`, `deleted_at`, `labels`; finance
`UserTransactionCategory` rows marked `is_manual`,
`excluded_amount`, rules, limits, alerts. Local edits pending
push (`needs_push=True`) SHALL be pushed before the pull merges
remote state.

#### Scenario: Manual category survives transaction sync

- **WHEN** a transaction with an `is_manual` category assignment
  is updated by a sync
- **THEN** the assignment row and its category are untouched

#### Scenario: Recurring-task succession preserves local metadata

- **WHEN** Google spawns a new remote id for the next occurrence
  of a recurring task
- **THEN** sync merges it into the single open same-titled local
  row (rewriting `task_id`) so stars, labels, ordering, and
  pending edits carry over; ambiguous cases create a new row

#### Scenario: Outgoing edits flush before incoming merge

- **WHEN** `sync_tasks` runs for a user with `needs_push` rows
- **THEN** `push_local_changes` pushes those edits to Google
  before remote state is pulled and merged
