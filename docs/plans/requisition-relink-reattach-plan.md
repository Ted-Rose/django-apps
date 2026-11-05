# Fix: Reattach existing accounts when a relink returns the same account IDs

Status: implemented

## Root cause (verified against prod, read-only, 2026-11-05)

Swedbank (`SWEDBANK_HABALV22`) requisitions return **stable**
account IDs across relinks — the assumption in
`finance/views.py` that "a relink always returns NEW ids" is
false for this institution.

Requisition #19 (`6bb076c1-…`, status `LN`) lists the same 10
account IDs that were already stored as `Account` rows under
requisition #11 (status `SU`). In `requisition_callback`:

```python
account = Account.objects.filter(account_id=account_id).first()
if account is None:
    ... _link_account(...)
```

When the row exists, the loop does nothing — the row stays
pointed at the dead requisition. Every `status='LN'` fetch set
(`sync_transactions`, `check_balance_alerts`,
`refresh_balances`) then skips these accounts → the "fetch
fails" symptom. Verified: all GoCardless API calls
(details/balances/transactions) succeed for all 10 IDs — no
upstream error exists.

Requisition #18 (also `LN`, same 10 IDs, 0 local rows) has the
identical problem.

## Fix — `finance/views.py::requisition_callback`

When `Account.objects.filter(account_id=…)` hits:

1. Row's requisition is already `LN` → leave untouched (just
   ensure the `UserAccountPreference`, as today).
2. Row's requisition is non-`LN` AND `account.owner ==
   request.user` AND `account.institution_id ==
   requisition.institution_id` → reattach in place:
   `account.requisition = requisition` (account_id is already
   identical); refresh `name`/`currency` like `_link_account`
   does (fetch details first — reuse `_link_account`'s
   name/currency-refresh semantics, i.e. keep stored currency
   when payload is missing/`XXX`). Log an info line.
3. Otherwise (different owner, or mismatched institution — the
   account_id `unique` constraint means we cannot create a
   duplicate) → log a warning, leave the row, still ensure the
   preference for the *existing* account only if
   `account.owner == request.user` (never grant a preference on
   another user's account).

Keep the `account is None` path unchanged.

## Data repair — management command

New `finance/management/commands/reattach_relinked_accounts.py`
(must support `--dry-run`):

- For every `Requisition` with `status='LN'`, call
  `client.get_requisition_data()`; collect its account IDs.
- For each returned ID where `Account.account_id` exists but
  `account.requisition_id != requisition.id` and the current
  requisition is non-`LN`: repoint `account.requisition` to
  the `LN` requisition (same owner/institution guards as
  above). Count and log each reattach; `--dry-run` only logs.
- Per-requisition `GoCardlessError` is logged and skipped.

Run once post-deploy to repair the 10 rows stranded on req #11
(will repoint them to req #19 — the newest `LN` requisition
listing those IDs).

## Tests — `finance/tests.py`

- Callback relink with same account_ids under a dead (`SU`)
  requisition → rows repointed to the new `LN` requisition,
  transactions/shares preserved (FK unchanged except
  `requisition`).
- Existing account under a still-`LN` requisition → untouched.
- Existing account owned by a different user → untouched, no
  `UserAccountPreference` created for the wrong account.
- `reattach_relinked_accounts --dry-run` logs but doesn't
  write; without the flag it repoints and is idempotent.

## Docs

- `finance/AGENTS.md`: correct the "relink always returns NEW
  ids" claim — Swedbank returns stable IDs; document the
  callback's reattach-on-existing-ID path and the new command.
- `docs/changelog.md`: user-visible fix entry.
- This plan's `Status:` → `implemented` in the same PR.

## Out of scope

- Frontend changes (none needed — no API contract change).
- OpenSpec: bug fix restoring documented behavior; no spec
  delta required (check `openspec/specs/` only if the
  reviewer flags drift).
