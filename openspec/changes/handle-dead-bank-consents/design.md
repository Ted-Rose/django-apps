# Design

## Context

See proposal.md for motivation. Constraints that shape the
approach:

- `GoCardlessError(status_code, body)` — `body` is raw
  `response.text`. GoCardless error payloads are JSON with
  `summary`/`detail` fields (`{"summary":"Account
  suspended","detail":"This account or its consent was
  suspended due to numerous errors..."}`); the 401 surfaces
  `AccessExpiredError` in `summary`/`type`.
- GoCardless requisition lifecycle: `CR → GC → UA → (RJ|SA →
  GA) → LN → EX`, plus `SU` reachable any time after `LN`
  (docs: "create a new requisition to reconnect"). `EX`/`SU`
  are the terminal values to stamp locally.
- `Account.account_id` is globally unique and requisition-
  scoped on the provider side — a relink always returns NEW
  ids, so `account_id` can never be the reconcile key.
- All `status='LN'` filters already exist:
  `api.sync_transactions` (api.py ~1506) and
  `sync_bank_transactions` (~line 33) filter before looping;
  marking `EX`/`SU` automatically drops dead consents out of
  future runs. `check_balance_alerts` (~line 42) and
  `refresh_balances` (~line 1703) do NOT filter — they fetch
  for every alerted/balance-check account.
- `fetch_balances_parallel` captures per-account failures
  into a result dict (`ok`/`rate_limited`/`error: str(exc)`)
  — the exception object is lost, so the dict must carry the
  terminal classification for callers to act on.
- `requisition_callback` (views.py ~79) does
  `get_or_create(account_id=…)` and only fetches
  `get_account_details` for created rows. Details carry
  `iban`/`name`/`currency`.
- Tests mock `GoCardlessClient` via `patch('finance.api.|
  views.GoCardlessClient')`; factories `make_requisition`
  (status arg), `make_account` exist in `finance/tests.py`.

## Goals / Non-Goals

**Goals:**

- Terminal consent errors are detected once, stamped onto
  `Requisition.status`, and never retried — no API call per
  dead account per run, in any path (API sync, daily command,
  balance refresh, balance alerts).
- Users see the existing `requisitionNotLinked` outcome and
  reconnect via the normal connect flow.
- Relink reconciles by IBAN so the original `Account` row —
  and everything keyed to its pk — survives.
- No schema changes, no frontend or locale edits, no
  migrations.

**Non-Goals:**

- No deleting/archiving dead accounts or requisitions, and no
  UI for dead-account management (issue's explicit
  out-of-scope).
- No notification/push when a consent dies — the
  `requisitionNotLinked` result on next sync is the signal.
- No periodic `get_requisition_data` status polling — local
  status is updated only when a fetch already failed or the
  callback returns fresh data (as today).

## Decisions

### 1. Classification lives on `GoCardlessError`

Add a property `dead_requisition_status` on `GoCardlessError`
in `services/gocardless.py` returning `'EX'`, `'SU'`, or
`None`. Rules (both sides required — status code AND body
marker, so a random 401/409 can never kill a consent):

- `status_code == 401` AND the parsed body's
  `summary`/`type` equals `AccessExpiredError` (fallback:
  literal substring in the raw body when JSON parse fails or
  the fields are absent) → `'EX'`
- `status_code == 409` AND `'suspend'` appears in
  `summary`+`detail` lowercased (covers "Account suspended"
  and future "consent suspended" wordings) → `'SU'`
- anything else → `None`

- Alternative — refetch `get_requisition_data` on failure to
  read the true status: an extra API call per failure, and
  requisition GET can itself 409 on suspension. Rejected —
  the error body already tells us the terminal kind and the
  mapping to GoCardless's own statuses is documented.

### 2. One marking helper, no model change

New `finance/services/requisitions.py` with
`mark_requisition_dead(account, new_status)` — sets
`account.requisition.status`, saves
`update_fields=['status', 'updated_at']` only when different,
logs one warning (`gocardless.py` stays a pure API client;
the DB write belongs in a service). Idempotent so marking
per-account across a 10-account requisition is harmless.

### 3. `fetch_balances_parallel` results carry `dead_status`

The GoCardlessError branch gains
`'dead_status': exc.dead_requisition_status`; the `ok` and
`HTTPError` branches set `None`. Callers treat a truthy
`dead_status` as mark-and-skip (counted as `failed` that
run — it did fail). Key name mirrors the classification;
`rate_limited`/`error` keys are untouched.

### 4. Sync paths: mark once, then skip in-run

Both transaction paths keep a per-run
`dead: dict[requisition_pk, status]`:

- `api.sync_transactions` (~line 1538): before calling
  `sync_account_transactions`, skip accounts whose
  `requisition_id` is in `dead` (append the same skipped-entry
  shape the `!= 'LN'` pre-pass emits). Add an
  `except GoCardlessError` branch BEFORE the broad
  `except Exception`: `dead_status` truthy →
  `mark_requisition_dead` + record in `dead` + emit the
  `requisitionNotLinked` result (`params.status` = new
  status); falsy → fall into the existing `operationFailed`
  handling.
- `sync_bank_transactions` (~line 56): same `dead` dict check
  inside the loop + GoCardlessError terminal check in the
  except — mark, log "bank must be relinked", continue.
  `select_related('requisition')` is already there.
- `check_balance_alerts` (~line 42): the alerts queryset gains
  `account__requisition__status='LN'` — dead consents never
  enter the fetch set; on a `dead_status` result, mark the
  requisition and keep the existing skip-failed behavior.
- `api.refresh_balances` (~line 1703): filter the fetch set
  to `requisition__status='LN'` at the call site (NOT inside
  `_balance_check_accounts` — the GET `/balances/` list keeps
  showing dead accounts' stored balances). When the
  LN-filtered set is empty but the unfiltered set was not,
  return `success: false` with code `requisitionNotLinked`
  and the dead status in `params.status`; mixed cases fetch
  only the live accounts.

### 5. Callback reconciles by normalized IBAN

In `requisition_callback`, for each returned `account_id`
not already in `Account` (existing rows untouched, as today):

1. Fetch `get_account_details` (GoCardlessError → `{}`, same
   fallback as today) — needed for the IBAN regardless.
2. `iban = (details.get('iban') or '').replace(' ', '')
   .upper()` — normalize spaces/case before comparing.
3. If `iban`: candidate query
   `Account.objects.filter(owner=request.user,
   institution_id=requisition.institution_id, iban=iban)`
   `.exclude(requisition__status='LN')` (normalize the stored
   side the same way when comparing — store/compare
   normalized).
   - exactly 1 candidate → reattach: set `account_id`,
     `requisition`; `name = details.get('name') or
     account.name`; `currency = new-if-usable else existing`
     (`'XXX'`/missing keeps the stored currency); save;
     log the reattach.
   - 0 or >1 candidates → create new (>1 also logs a
     warning — ambiguous means no reattach, per the issue).
4. No/empty IBAN → create new.

`UserAccountPreference.objects.get_or_create` runs for the
resulting row exactly as today.

- Alternative — pick the lowest-pk candidate on ambiguity:
  deterministic but silently guesses wrong half the time and
  hides data corruption; the issue prefers no reattach on
  ambiguity. Rejected.
- Alternative — also update the stored `iban` on reattach:
  unnecessary, it matched by definition.
- The old dead `Requisition` row is left as the audit record;
  it just ends up with zero accounts.

### 6. Nothing else changes

Response schemas (`SyncOut`/`RefreshOut`), the
`requisitionNotLinked` locale strings, `openapi.json`, and
`api-types.ts` are untouched — the new per-account `code`
value flows through the existing `code`/`params` contract.

## Risks / Trade-offs

- `Account.objects.filter(iban=…)` sees the stored form —
  normalization on both sides must match or reattach misses
  → spec the normalization explicitly; store/compare
  normalized on write and match.
- Body-marker matching could false-positive a different
  suspension type → both status code AND marker required;
  worst case is a correctly-dead consent anyway (429 storms
  precede suspensions).
- In-flight `fetch_balances_parallel` threads still hit a
  requisition marked by a sibling result → accepted; marking
  happens on result processing, the next run filters them
  out. One wasted call set, then silence.
- A user re-linking while the old consent still shows `LN`
  on GoCardless's side → IBAN candidates are
  `status != 'LN'` only, so live accounts never reattach;
  duplicates can still occur if the old consent is
  technically alive — acceptable, matches "dead only".
- Marking on the API path writes the shared DB from a web
  request → single `UPDATE` per dead requisition, bounded.

## Migration Plan

1. Ship backend only — no migration, no frontend build.
2. Existing dead-but-`LN` requisitions self-heal: the first
   sync/refresh after deploy hits the terminal error, marks
   `EX`/`SU`, and they drop out of all fetch paths. No data
   backfill needed.
3. Rollback: revert the code; any reattached rows keep their
   new `account_id`/`requisition` (still correct — the link
   is live). Stamped `EX`/`SU` statuses stay accurate.

## Open Questions

- Should a reattach clear the stale `last_balance`/
  `balance_updated_at`? Spec keeps them (timestamp shows the
  age; first refresh overwrites) — revisit if users
  misread it.
- Should `check_balance_alerts` deactivate alerts on dead
  accounts? Spec keeps them active-but-skipped so a relink
  resume is automatic via the reattached row.
