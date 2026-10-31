# Proposal

## Why

A dead GoCardless consent is retried forever. When a Swedbank
requisition's access expired, every daily sync kept calling the
API (~30 failures/day) until GoCardless suspended the whole
consent — and `Requisition.status` still said `LN`, so the UI
showed the accounts as linked. Relinking then made it worse:
GoCardless account ids are requisition-scoped, so
`requisition_callback` created ten duplicate `Account` rows and
the new rows lost shares, limits, alerts, prefs and transaction
continuity (issue #57).

## What Changes

- Terminal-consent detection: `GoCardlessError` classifies
  `401 AccessExpiredError` and `409 Account suspended` bodies as
  terminal; callers stamp `Requisition.status` `EX` / `SU`
  (GoCardless's own lifecycle statuses) so every `status='LN'`
  filter skips them and sync reports the existing
  `requisitionNotLinked` "bank must be relinked" result.
- Retry-storm cutoffs in all fetch paths: `sync_transactions`
  and `sync_bank_transactions` mark dead requisitions and skip
  remaining same-requisition accounts within a run;
  `refresh_balances` and `check_balance_alerts` fetch only
  LN-requisition accounts and mark requisitions whose
  `fetch_balances_parallel` result reports a terminal error.
- IBAN relink reconciliation in `requisition_callback`: a new
  `account_id` whose IBAN matches exactly one same-owner,
  same-institution `Account` under a non-LN requisition is
  reattached in place (new `account_id`/`requisition`, refreshed
  name/currency) preserving transactions, shares, limits,
  alerts and prefs; anything else creates a row as today.
- No frontend or locale change — the `requisitionNotLinked`
  copy already exists in `en.json`/`lv.json` and no API schema
  changes.

## Capabilities

### New Capabilities

- `bank-consent`: GoCardless requisition lifecycle handling —
  detecting terminal consent errors, marking local requisition
  status, skipping dead consents across all fetch paths, and
  reconciling relinked accounts by IBAN at callback time.

### Modified Capabilities

- `external-sync`: "Local state survives re-sync" gains the
  relink case — an IBAN-matched reattach rewrites `account_id`
  in place so local-only rows survive a remote id change.

## Impact

- `finance/services/gocardless.py`: `GoCardlessError` gains
  terminal-status classification (parses the raw JSON body);
  `fetch_balances_parallel` results gain a `dead_status` key.
- `finance/services/` (new small module, e.g.
  `requisitions.py`): `mark_requisition_dead` helper.
- `finance/api.py`: `sync_transactions` dead-requisition
  branch (emits `requisitionNotLinked`, not `operationFailed`);
  `refresh_balances` LN-filters its fetch set and returns
  `requisitionNotLinked` when every balance-check account is
  dead.
- `finance/management/commands/sync_bank_transactions.py` and
  `check_balance_alerts.py`: mark-and-skip behavior.
- `finance/views.py`: `requisition_callback` IBAN reconcile.
- `finance/tests.py` / `finance/test_api.py`: new tests —
  GoCardless client stays mocked; no real API calls.
- No migrations, no API schema drift (`openapi.json` /
  `api-types.ts` unchanged — response shapes are untouched),
  no frontend or locale edits.
