# finance — Agent Guide

Bank account aggregation via the **GoCardless Bank Account Data API**
(`https://bankaccountdata.gocardless.com/api/v2/`). Lets users link
bank accounts, share them read-only with other users, sync booked
transactions, and get spending-limit alerts.

## External API client (`services/gocardless.py`)

`GoCardlessClient` — minimal raw-HTTP `requests` client (no SDK):

- Bearer token from `token/new/` cached per-instance with a 60s expiry
  margin; 30s request timeout.
- Failures raise `GoCardlessError(status_code, body)` — API ops map
  it to `502 {error: 'upstream_error'}`; `requisition_callback`
  still surfaces it via `messages.error`.
- `fetch_balances_parallel` uses `ThreadPoolExecutor` (max 8 workers);
  per-account failures are captured in results, not raised.
- Credentials come from `settings.GOCARDLESS_SECRET_ID` /
  `GOCARDLESS_SECRET_KEY`.

## Consent/link flow

1. Connect page (SPA `/finance/connect/`): user picks country →
   `GET /api/finance/institutions/?country=…` →
   `POST /api/finance/connect/` creates end-user agreement
   (**730 days history, 180 days access = API maximum**, scopes
   balances/details/transactions) + requisition with `redirect_url =
   {BASE_URL}/finance/callback/` → API returns `{link}` and the
   browser navigates to it (fetch never follows it);
   `requisition_id` stored in session.
2. `requisition_callback` (`/finance/callback/`, the one remaining
   Django view in `views.py`): reads `session['requisition_id']`,
   refetches requisition, proceeds only when `status == 'LN'`
   (linked). Creates `Account` rows for each returned account id +
   fetches details (iban/name/currency) + creates a default
   `UserAccountPreference`, then redirects to `finance:accounts`
   (the SPA).

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
- `TransactionLimit` — per-user outgoing spending limits covering
  one or more `accounts` (M2M — the SPA form checks accounts, a
  same-category limit must not overlap another's accounts, enforced
  as a 409 in `save_limit` since unique constraints can't span a
  M2M). Three window kinds: rolling 7 days, rolling
  30 days, or the current calendar month. `category` is optional —
  when set, only the limit user's own category assignments count.
  `alerted_7d_at` / `alerted_30d_at` / `alerted_monthly_at` are
  per-window episode flags for push alerts: set when a breach
  notification is sent, cleared once spending falls back under the
  threshold so the next breach alerts again. Window math
  (`limit_windows`, `monthly_period_start`), spend sums
  (`spent_in_window`), display stats (`limit_window_stats`) and the
  per-past-month breakdown (`monthly_history`) live in
  `services/limits.py`, shared by the limits endpoint and
  `evaluate_spending_limits`. The SPA limits page shows progress
  bars per window plus expandable past-month history, and an
  "Overview" month dropdown (`?month=YYYY-MM` on
  `GET /api/finance/limits/`) re-evaluates every window as of the
  selected month's last day (`as_of` in `limit_window_stats`); rows
  are edited via `?edit=<id>` client-side and deleted via
  `POST /api/finance/limits/<id>/delete/`.
- `LimitEvaluation` — one row per `(limit, calendar month)` written
  by `evaluate_spending_limits`: the current month's row refreshes
  every run; the just-ended month is backfilled with the full-month
  total while keeping its recorded threshold. `monthly_history`
  prefers recorded rows and falls back to recomputed spend for
  months that predate the first evaluation.
- `BalanceAlert` — per `(user, account)` low-balance threshold
  (`threshold` may be negative for overdraft alerts). Sharers set
  their own. `alerted_at` is the episode flag: stamped when the
  breach notification goes out, cleared once the balance is back
  at/above the threshold so the next drop alerts again. Managed via
  `POST /api/finance/accounts/<id>/balance-alert/` (+ `/delete/`)
  from the Accounts page bell; `AccountOut.balance_alert` carries
  the caller's threshold and the Balances cards show a read-only
  badge.
- `Notification` — in-app alert row (title/body/url/read_at),
  finance-scoped for now. `check_balance_alerts` writes one per
  breach so users with zero push subscriptions still see the alert:
  `GET /api/finance/notifications/` returns unread rows which
  `App.tsx` drains into toasts on SPA load, then marks them read
  via `POST /api/finance/notifications/read/`. Rows are kept
  (audit trail).
- `PushSubscription` — one row per subscribed browser (`endpoint`
  unique); feeds Web Push spending alerts via `services/push.py`
  (`send_limit_alert`, uses `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
  settings; 403/404/410 responses delete stale rows). Browsers
  subscribe via `POST /api/finance/push/subscribe/` (+
  `unsubscribe/`) from the SPA's limits page
  (`usePushSubscription` hook); no-op when `VAPID_*` settings are
  empty.
- `Category` — per-user, unique on `(user, name)`, optional hex color.
- `CategoryRule` — per-user auto-categorization rule. Counterparty
  condition: `counterparty_pattern` + `counterparty_match_type`
  against the name field picked by `counterparty_scope`
  (`debtor`/`creditor`/`any`); description condition:
  `description_pattern` + `description_match_type` against
  remittance info. Match types are
  contains/equals/starts_with/ends_with, case-insensitive; the two
  conditions combine via `operator` (AND/OR).
  `description_exclusion` vetoes the match when its text appears in
  remittance info. Evaluated in `(priority, pk)` order —
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
  window — 7-day, 30-day, or monthly — via `services/limits.py`
  (filtered to the limit's category when set); logs
  `SPENDING_LIMIT_EXCEEDED ...` warnings and sends one Web Push
  notification per limit per breach episode (both windows naming in
  a single notification when breached together) to the user's
  `PushSubscription`s.
- `check_balance_alerts` (`--dry-run`): fetches each alerted
  account's balance once (`fetch_balances_parallel`, deduped across
  users of shared accounts), writes `Account.last_balance`/
  `balance_updated_at` like `POST /api/finance/balances/refresh/`,
  then evaluates each `BalanceAlert` — below threshold with no
  `alerted_at` creates the in-app `Notification` row AND pushes via
  `send_limit_alert`, then stamps `alerted_at` unconditionally (the
  Notification row is the record of delivery). Accounts whose fetch
  failed/429'd or whose currency mismatches are skipped — never
  alert on a stale stored balance. Logs `BALANCE_ALERT_TRIGGERED`.
- Terraform (`terraform/cloud_run_jobs.tf`) maps these to Cloud Run
  jobs with Cloud Scheduler triggers running daily (`paused = false`:
  sync at 02:00 UTC, evaluate at 02:30 UTC, balance alerts at
  03:00 UTC) — set `paused = true` to
  stop the schedules and save costs.

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
  *previewing user's* assignments. Used by the SPA's rule drawer
  (`frontend/src/finance/components/RuleDrawer.tsx`), which posts
  debounced previews to `POST /api/finance/rules/preview/`. The
  drawer also opens from the transactions page — the row's category
  badge is a dropdown whose menu carries "Create rule from this
  transaction", prefilling the form with that transaction's
  counterparty + description (the route lazy-fetches
  `GET /api/finance/rules/` for the form's choice lists).
- Manual category assignment: the same badge menu posts
  `POST /api/finance/transactions/<id>/category/` (`{category}`,
  null = locked-uncategorized — the `UserTransactionCategory.category`
  FK is nullable) to write an `is_manual` row, and
  `…/category/clear/` unsets the flag and re-runs
  `categorize_transaction` for that one transaction so the badge
  immediately shows the rules' result. `TransactionOut` carries
  `category_is_manual` (the pencil marker); `GET
  /api/finance/transactions/?source=manual` is the audit filter
  ("Manual only" in the Category column header menu + a removable
  chip).

## Effective-category reads (`services/categories.py`)

- Every per-user read of a transaction's category goes through
  `annotate_effective_category(qs, user)` (adds
  `effective_category_id`) or `effective_category_for(tx, user)` —
  never query `category_assignments` ad hoc. There is intentionally
  no owner-fallback: a user sees exactly the taxonomy their own
  rules/limits operate on.

## Views & API (post-cutover)

- The UI is the React SPA (`frontend/src/finance/`, Vite entry
  `finance`) served by `react_app` at `/finance/` + a
  `<path:subpath>` catch-all, with named shell routes
  (`index`/`connect`/`accounts`/`transactions`/`balances`/`limits`/
  `rules`/`categories`) so `reverse('finance:…')` keeps working for
  `home.html`, `evaluate_spending_limits` push URLs and the
  callback's redirects. `/finance/app/*` 301-redirects to
  `/finance/*` (legacy strangler mount); non-GET/HEAD requests under
  `/finance/` 404 — the template views and their form-POST URLs are
  gone (`finance/templates/` and `finance/static/` deleted).
- `requisition_callback` (`/finance/callback/`) stays a Django view
  forever — it's the `redirect_url` configured in GoCardless
  requisitions, reads the session and mutates the DB, then
  redirects into the SPA.
- All reads/mutations are the django-ninja router in `api.py`
  (`/api/finance/…`). Unlike google_tasks, nothing delegates to
  `views.py` — finance views were form-POST + `messages` +
  redirect, so `api.py` implements mutations directly, reusing the
  same forms (`forms.py` — kept for API validation), `services/`
  functions and `for_user()` scoping. Mutation successes return
  `{success, message}` for the SPA to toast; errors are
  `{error, detail}` (GoCardlessError → 502, limit conflict → 409,
  form failures → 400).
- Tests: `tests.py` uses `make_*` factory helpers and mocks the
  GoCardless client; HTTP-layer tests post JSON to `/api/finance/`
  (`test_api.py` covers the API contract itself).
