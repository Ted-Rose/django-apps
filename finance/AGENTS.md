# finance — Agent Guide

Bank account aggregation via the **GoCardless Bank Account Data API**
(`https://bankaccountdata.gocardless.com/api/v2/`). Lets users link
bank accounts, share them read-only with other users, sync booked
transactions, and get spending-limit alerts.

## External API client (`services/gocardless.py`)

`GoCardlessClient` — minimal raw-HTTP `requests` client (no SDK):

- Bearer token from `token/new/` cached per-instance with a 60s expiry
  margin; 30s request timeout.
- Failures raise `GoCardlessError(status_code, body)` — catch it in
  views and surface via `messages.error`.
- `fetch_balances_parallel` uses `ThreadPoolExecutor` (max 8 workers);
  per-account failures are captured in results, not raised.
- Credentials come from `settings.GOCARDLESS_SECRET_ID` /
  `GOCARDLESS_SECRET_KEY`.

## Consent/link flow

1. `connect_bank` (`/finance/connect/`): user picks country →
   `list_institutions` → POST creates end-user agreement
   (**730 days history, 180 days access = API maximum**, scopes
   balances/details/transactions) + requisition with `redirect_url =
   {BASE_URL}/finance/callback/` → user redirected to bank link;
   `requisition_id` stored in session.
2. `requisition_callback` (`/finance/callback/`): reads
   `session['requisition_id']`, refetches requisition, proceeds only
   when `status == 'LN'` (linked). Creates `Account` rows for each
   returned account id + fetches details (iban/name/currency) +
   creates a default `UserAccountPreference`.

## Data model & access control

- `Requisition` — consent object; status lifecycle CR → … → LN.
- `Account` — owned by `owner`, linked via `requisition`.
- `AccountShare` — grants another user read access.
- `UserAccountPreference` — per-user `included_in_balance_check` toggle
  (created automatically on link/share).
- `Transaction` — booked transactions; `amount < 0` = outgoing.
  Unique per `(account, transaction_id)`. Raw bank data only —
  categorization is per-user (below).
- `UserTransactionCategory` — one user's category assignment for a
  transaction, unique per `(user, transaction)`. Owner and sharers
  each have their own rows; `is_manual` is a per-user override rules
  never touch. A `post_delete` receiver on `AccountShare`
  (`signals.py`, wired via `FinanceConfig.ready`) deletes the
  ex-viewer's rows when a share is revoked. No row = uncategorized
  for that user — sharers never see the owner's categories.
- `TransactionLimit` — per `(account, user, category)` 7-/30-day
  outgoing spending limits; `category` is optional — when set, only
  the limit user's own category assignments count. `alerted_7d_at` /
  `alerted_30d_at` are per-window episode flags for push alerts: set
  when a breach notification is sent, cleared once spending falls
  back under the threshold so the next breach alerts again.
- `PushSubscription` — one row per subscribed browser (`endpoint`
  unique); feeds Web Push spending alerts via `services/push.py`
  (`send_limit_alert`, uses `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
  settings; 403/404/410 responses delete stale rows). Browsers
  subscribe via `POST /finance/push/subscribe/` (+ `unsubscribe/`)
  from the limits page; no-op when `VAPID_*` settings are empty.
- `Category` — per-user, unique on `(user, name)`, optional hex color.
- `CategoryRule` — per-user auto-categorization rule; patterns match
  debtor/creditor name (`sender_receiver_pattern`) and remittance
  info (`description_pattern`) via `match_type`
  (contains/equals/starts_with/ends_with, case-insensitive),
  combined with
  `operator` (AND/OR). Evaluated in `(priority, pk)` order —
  **first match wins**.

**Always** query accounts/transactions through
`Account.objects.for_user(user)` / `Transaction.objects.for_user(user)`
(owned OR shared, `managers.py`) — never bare `objects.all()` in views.
Ownership-only checks (e.g. sharing) use `owner=request.user`.

## Management commands → Cloud Run jobs

- `sync_bank_transactions` (`--dry-run`): incremental sync per
  `status='LN'` account using `Max(booking_date)` as `date_from`;
  `update_or_create` on transaction id; only `booked` transactions;
  per-account failures are logged and don't abort the run. Synced
  rows are auto-categorized per viewer — one pass writes the
  owner's `UserTransactionCategory` row plus each sharer's via
  `categorize_transaction()`.
- `evaluate_spending_limits`: sums negative amounts per active limit
  window (filtered to the limit's category when set); logs
  `SPENDING_LIMIT_EXCEEDED ...` warnings and sends one Web Push
  notification per limit per breach episode (both windows naming in
  a single notification when breached together) to the user's
  `PushSubscription`s.
- Terraform (`terraform/cloud_run_jobs.tf`) maps these to Cloud Run
  jobs with Cloud Scheduler triggers — schedulers are **paused**, so
  nothing runs on a schedule until unpaused.

## Rules engine (`services/rules.py`)

- `rule_matches` / `first_matching_rule` are pure functions;
  `apply_rules(user)` re-categorizes **all** transactions the user
  can see (owned **and** shared — the assignment table keys by user,
  so a sharer's rules are meaningful on shared accounts). Call it
  after any ruleset mutation (rule save/delete/move, category
  delete).
- `categorize_transaction(tx, rules, user)` upserts/deletes that
  user's assignment row and skips `is_manual` rows.
- `preview_rule(user, data)` dry-runs a candidate rule over history
  and returns match/apply/change counts + a capped `changes` diff —
  it never writes, and the diff's old/new categories are the
  *previewing user's* assignments. Used by the rule sandbox drawer
  (`rules.html` + `static/finance/js/rule_sandbox.js`), which posts
  to `rules/preview/` — the app's one AJAX/JSON endpoint.

## Effective-category reads (`services/categories.py`)

- Every per-user read of a transaction's category goes through
  `annotate_effective_category(qs, user)` (adds
  `effective_category_id`) or `effective_category_for(tx, user)` —
  never query `category_assignments` ad hoc. There is intentionally
  no owner-fallback: a user sees exactly the taxonomy their own
  rules/limits operate on.

## Conventions

- Forms in `forms.py`; views pass `burger_menu_items` for nav and use
  `django.contrib.messages` for feedback (this app uses message
  redirects rather than AJAX JSON).
- Tests: `tests.py` uses `make_*` factory helpers and mocks the
  GoCardless client.
