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
  Unique per `(account, transaction_id)`.
- `TransactionLimit` — per `(account, user)` 7-/30-day outgoing
  spending limits.

**Always** query accounts/transactions through
`Account.objects.for_user(user)` / `Transaction.objects.for_user(user)`
(owned OR shared, `managers.py`) — never bare `objects.all()` in views.
Ownership-only checks (e.g. sharing) use `owner=request.user`.

## Management commands → Cloud Run jobs

- `sync_bank_transactions` (`--dry-run`): incremental sync per
  `status='LN'` account using `Max(booking_date)` as `date_from`;
  `update_or_create` on transaction id; only `booked` transactions;
  per-account failures are logged and don't abort the run.
- `evaluate_spending_limits`: sums negative amounts per active limit
  window; logs `SPENDING_LIMIT_EXCEEDED ...` warnings (email sending is
  a TODO — no `EMAIL_*` settings configured).
- Terraform (`terraform/cloud_run_jobs.tf`) maps these to Cloud Run
  jobs with Cloud Scheduler triggers — schedulers are **paused**, so
  nothing runs on a schedule until unpaused.

## Conventions

- Forms in `forms.py`; views pass `burger_menu_items` for nav and use
  `django.contrib.messages` for feedback (this app uses message
  redirects rather than AJAX JSON).
- Tests: `tests.py` uses `make_*` factory helpers and mocks the
  GoCardless client.
