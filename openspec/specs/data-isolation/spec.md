# Data Isolation Specification

## Purpose

Defines the per-user data isolation invariant: every piece of
user data in the monolith is scoped to the requesting user, with
finance's explicit sharing layer (`for_user` managers,
`AccountShare`, `CategoryOverviewShare`) as the only sanctioned
widening. A violation here is a privacy breach, not a bug —
single-user assumptions do not exist in this codebase.

## Requirements

### Requirement: Per-user query scoping

Every ORM query for user data SHALL filter by the requesting user
(`user=request.user` or equivalent). Object lookups by primary
key SHALL scope `get_object_or_404` by user so another user's
object reads as missing, not forbidden. Mutations SHALL only ever
touch the caller's own rows.

#### Scenario: Direct id access to another user's object 404s

- **WHEN** user B requests or mutates an object owned by user A
  via its id (e.g. `/api/tasks/<id>/`, a label pk, a transaction
  pk)
- **THEN** the response is 404 — the object is invisible, not
  merely rejected

#### Scenario: List endpoints return only the caller's rows

- **WHEN** a user lists tasks, labels, accounts, transactions,
  limits, alerts, or notifications
- **THEN** only rows scoped to that user (plus explicitly shared
  finance rows) appear

### Requirement: Finance shared-account reads via for_user

Finance reads SHALL go through `Account.objects.for_user(user)`
and `Transaction.objects.for_user(user)`
(`finance/managers.py`), which return owned OR shared rows —
never bare `objects.all()` in views or endpoints.
Ownership-only operations (sharing, account deletion) SHALL check
`owner=request.user` instead. Sharers get read-only visibility;
per-user annotations (categories, excluded amounts, balance
alerts, preferences) are always the caller's own rows.

#### Scenario: Sharer sees shared accounts and transactions

- **WHEN** a user with an `AccountShare` queries accounts or
  transactions
- **THEN** shared rows are visible through `for_user` and are
  read-only to the sharer

#### Scenario: Sharer cannot perform owner-only operations

- **WHEN** a sharer attempts an ownership-gated operation
  (e.g. managing shares, deleting the account)
- **THEN** the request is rejected — `for_user` visibility does
  not imply ownership

#### Scenario: Category assignments are per-viewer

- **WHEN** a transaction is visible to both its owner and a
  sharer
- **THEN** each user's `UserTransactionCategory` row determines
  only their own view — sharers never see the owner's
  categorization

### Requirement: Local-only state is never exposed cross-user

Local-only features layered on mirrored remote objects —
google_tasks stars, labels, dividers, archive/trash state,
manual ordering; finance categories, rules, limits,
notifications — SHALL be stored as per-user rows and filtered
per-user like everything else, and SHALL NOT be pushed to the
external provider.

#### Scenario: Local metadata is invisible to other users

- **WHEN** user A stars a task or labels a transaction
- **THEN** that state exists only on user A's rows and never
  leaks into user B's API responses or the provider mirror
