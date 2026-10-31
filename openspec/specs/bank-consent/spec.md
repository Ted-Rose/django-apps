# bank-consent Specification

## Purpose
Defines how the app handles the GoCardless requisition
(consent) lifecycle beyond the happy path: recognizing
terminal consent errors, retiring dead requisitions so fetch
paths stop retrying them, and reconciling accounts by IBAN
when a bank is relinked.

## Requirements

### Requirement: Terminal consent errors retire the requisition

When GoCardless answers an account-scoped call with a terminal
consent error — HTTP 401 whose body identifies
`AccessExpiredError`, or HTTP 409 whose body reports the
account/consent suspended — the system SHALL stamp the owning
`Requisition.status` with GoCardless's matching lifecycle
value (`EX` or `SU`). Other failures (429, 5xx, network,
non-terminal 4xx) SHALL NOT change the status.

#### Scenario: AccessExpiredError marks the requisition expired

- **WHEN** a GoCardless account call fails with HTTP 401 and a
  body identifying `AccessExpiredError`
- **THEN** the owning requisition's `status` becomes `EX`

#### Scenario: Suspended consent marks the requisition suspended

- **WHEN** a GoCardless account call fails with HTTP 409 and a
  body whose summary/detail reports the account or consent
  suspended
- **THEN** the owning requisition's `status` becomes `SU`

#### Scenario: Terminal classification parses the raw JSON body

- **WHEN** a `GoCardlessError` carries a raw-text body
- **THEN** classification SHALL `json.loads` it and inspect the
  `summary`/`detail`/`type` fields, tolerate non-JSON bodies,
  and require BOTH the HTTP status and the body marker — one
  alone never marks a requisition dead

#### Scenario: Transient errors leave the status untouched

- **WHEN** a GoCardless call fails with 429, 5xx, a network
  error, or a 4xx without a terminal marker
- **THEN** `Requisition.status` is unchanged and the failure is
  logged like today

### Requirement: Dead requisitions are skipped, not retried

Every per-account GoCardless fetch SHALL exclude accounts
whose `Requisition.status != 'LN'`, and a terminal error SHALL
stop further same-requisition calls within the same run. Sync
SHALL report dead-requisition accounts with the existing
`requisitionNotLinked` outcome instead of a raw error detail.

#### Scenario: Terminal sync failure becomes relink-needed

- **WHEN** transaction sync hits a terminal consent error on
  an account
- **THEN** the requisition is marked dead and the account is
  reported with the `requisitionNotLinked` code (same shape
  as the existing not-LN skipped entries), not
  `operationFailed`

#### Scenario: One dead requisition, one API call per run

- **WHEN** a sync run marks a requisition dead
- **THEN** remaining accounts under that requisition in the
  same run are reported relink-needed WITHOUT another
  GoCardless call

#### Scenario: Balance fetches only call linked accounts

- **WHEN** `POST /api/finance/balances/refresh/` or
  `check_balance_alerts` builds its fetch set
- **THEN** only accounts under `LN` requisitions are fetched;
  a terminal per-account fetch result still marks the
  requisition dead, and a refresh where every balance-check
  account is dead returns `success: false` with code
  `requisitionNotLinked`

#### Scenario: Balance alerts never fire off a dead consent

- **WHEN** `check_balance_alerts` evaluates alerts
- **THEN** accounts under non-`LN` requisitions are excluded
  from fetching and never evaluated — a stale stored balance
  must never alert

### Requirement: Relink reconciles accounts by IBAN

In the requisition callback, an unknown `account_id` whose
fetched IBAN uniquely matches an existing `Account` of the
same owner AND institution whose requisition is not `LN`
SHALL be reattached in place: `account_id` and `requisition`
are rewritten, name/currency refreshed. Every other case
creates a new row.

#### Scenario: IBAN match reattaches the existing row

- **WHEN** a returned `account_id` is unknown locally and its
  IBAN matches exactly one same-owner, same-institution
  `Account` under a non-`LN` requisition
- **THEN** that row's `account_id` and `requisition` are
  updated to the new values — its pk, transactions, category
  assignments, `AccountShare`s, `TransactionLimit` membership,
  `BalanceAlert`s and `UserAccountPreference`s are preserved

#### Scenario: Reattach refreshes display fields safely

- **WHEN** a row is reattached
- **THEN** `name`/`currency` take the new details payload when
  usable, and keep the stored values when the payload omits
  them or reports `XXX`

#### Scenario: No IBAN match creates a new row

- **WHEN** a returned `account_id` is unknown and its IBAN
  matches no eligible `Account` (or details are unavailable)
- **THEN** a new `Account` row is created exactly as today

#### Scenario: Matching never crosses ownership or liveness

- **WHEN** an IBAN matches only accounts of another owner, a
  different institution, or a live (`LN`) requisition
- **THEN** no reattach happens — a new row is created

#### Scenario: Ambiguous match creates a new row

- **WHEN** more than one same-owner dead-requisition `Account`
  shares the IBAN
- **THEN** no reattach happens — a warning is logged and a new
  row is created
