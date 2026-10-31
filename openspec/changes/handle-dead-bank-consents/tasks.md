# Tasks

## 1. Backend — detection and marking

- [ ] 1.1 backend: Add `dead_requisition_status` to
  `GoCardlessError` in `finance/services/gocardless.py` —
  `json.loads` the raw body (tolerate non-JSON), require BOTH
  status code and body marker: 401 + `AccessExpiredError` in
  `summary`/`type` (substring fallback) → `'EX'`; 409 +
  `suspend` in `summary`+`detail` (lowercased) → `'SU'`;
  else `None`. Verify unit tests for EX/SU/None, a bare 401,
  a bare-JSON-body 200-style mismatch, and a non-JSON body
- [ ] 1.2 backend: Add `finance/services/requisitions.py`
  with `mark_requisition_dead(account, new_status)` — write
  `Requisition.status` + `update_fields=['status',
  'updated_at']` only when changed, one warning log; verify
  a test for the write and idempotent no-op
- [ ] 1.3 backend: Add `'dead_status'` to every
  `fetch_balances_parallel` result dict (`None` for
  ok/HTTPError, `exc.dead_requisition_status` for
  GoCardlessError); verify a test asserting the key exists
  on all three branches

## 2. Backend — sync paths stop retrying dead consents

- [ ] 2.1 backend: `api.sync_transactions` — per-run
  `dead` dict (requisition pk → status); pre-call skip for
  same-requisition accounts; `except GoCardlessError` branch
  before the broad `except` that marks + emits the
  `requisitionNotLinked` skipped-entry shape (status
  `'skipped'`, `params.status` = new status) instead of
  `operationFailed`. Verify tests: terminal error marks the
  requisition, sibling accounts emit relink-needed with no
  extra `fetch_transactions` call, transient error still
  yields `operationFailed`
- [ ] 2.2 backend: `sync_bank_transactions` — same per-run
  `dead` skip in the loop + terminal-`GoCardlessError` mark
  in the except (log relink-needed, continue); verify a
  command test where a 401 AccessExpiredError on account 1
  of a shared requisition marks it and account 2 is never
  fetched
- [ ] 2.3 backend: `check_balance_alerts` — add
  `account__requisition__status='LN'` to the alerts
  queryset and `mark_requisition_dead` on `dead_status`
  results; verify a test that alerts on a dead-requisition
  account produce no balance fetch and no notification

## 3. Backend — balance refresh path

- [ ] 3.1 backend: `api.refresh_balances` — LN-filter the
  fetch set at the call site (`_balance_check_accounts`
  stays shared/unfiltered so GET `/balances/` still lists
  stored balances), `mark_requisition_dead` on `dead_status`
  results, and `success: false` + `code:
  'requisitionNotLinked'` + `params.status` when every
  balance-check account is dead. Verify tests for the
  all-dead response, the mixed dead+live fetch set, and the
  mark-on-terminal-result path

## 4. Backend — relink reconciliation by IBAN

- [ ] 4.1 backend: `requisition_callback` — fetch details
  for each unknown `account_id` (existing `GoCardlessError`
  → `{}` fallback), normalize IBAN (strip spaces, upper),
  single-candidate match on `owner=request.user` +
  `institution_id` + `iban` + `requisition__status != 'LN'`
  → reattach in place (`account_id`, `requisition`, refresh
  `name`/`currency` keeping stored values when the payload
  omits them or says `XXX`); 0/>1 candidates or no IBAN →
  create as today (>1 logs a warning). Verify tests: reattach
  preserves pk/transactions/shares/limits/alerts/prefs, new
  account_id/requisition applied, plus the no-match,
  null-IBAN, cross-owner, live-requisition, and ambiguous
  create-new paths

## 5. Verification and docs

- [ ] 5.1 backend: Run `python manage.py test finance` (only
  the touched app per convention) and
  `manage.py export_openapi_schema --output
  frontend/openapi.json` — verify the schema diff is empty
  (no response-shape changes)
- [ ] 5.2 backend: Update `finance/AGENTS.md` (client
  terminal-error contract, dead-status marking, IBAN
  reconcile in the callback) and `docs/changelog.md`;
  verify `awk 'length > 79 {print FILENAME":"NR}'` on every
  touched file reports nothing

## Workflow follow-up

- Open a feature-branch PR per repo convention (body via
  temp file + `gh pr create --body-file`, UI verification
  section — reconnect flow exercised via `/finance/connect/`
  → callback → accounts list).
- Archive the change after merge via `openspec archive`.
