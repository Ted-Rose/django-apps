# Finance Balance Alerts

Status: implemented. Scope: `finance/` (model, API, management command),
`frontend/src/finance/` (Accounts bell), `terraform/cloud_run_jobs.tf`.

## Problem / goal

Let a user attach a low-balance alert to any account they can see
(owned or shared) from the Accounts page: a bell icon opens an inline
form, they enter a threshold, and a daily Cloud Run job refreshes the
stored balance and pushes a Web Push notification when the balance
drops below it. Mirrors how `TransactionLimit` + `evaluate_spending_limits`
already work — per-user row, episode-flag alerting, Web Push delivery,
daily Cloud Scheduler trigger.

## Existing pieces being reused

| Piece | Where | Reused for |
|---|---|---|
| `PushSubscription` + `send_limit_alert(user, title, body, url)` | `finance/models.py`, `finance/services/push.py` | Push delivery — the only way the headless daily job can reach a user (no session exists server-side). Already generic despite the name (title/body/url payload); no-op when `VAPID_PRIVATE_KEY` is empty or the user has no subscriptions — the in-app `Notification` fallback (below) covers that case. Renaming to `send_push_alert` is optional cosmetic cleanup. |
| Episode-flag alerting | `alerted_7d_at`/`alerted_30d_at`/`alerted_monthly_at` on `TransactionLimit`, evaluated in `finance/management/commands/evaluate_spending_limits.py` | Same one-notification-per-breach-episode semantics: set on first breach, cleared when back above threshold so the next drop alerts again. |
| `GoCardlessClient.fetch_balances_parallel` | `finance/services/gocardless.py` | One balance fetch per distinct account (max 8 workers); per-account failures/429s captured in the result dict, never raised. |
| `Account.last_balance` / `balance_updated_at` | `finance/models.py`, `POST /api/finance/balances/refresh/` | The job refreshes the same fields `balances/refresh/` writes — the Balances page gets daily-fresh data as a side effect. |
| `Account.objects.for_user(user)` | `finance/managers.py` | Per-user scoping (owned OR shared) for the API endpoints. |
| Inline-expand row action | `shareOpen` share form in `frontend/src/finance/routes/Accounts.tsx` (`.acct-share-form` below the card header) | The bell opens the same kind of inline form. |
| Push subscription UI | `PushCard` + `usePushSubscription` on the Limits page | No new subscription flow — alerts reuse the user's existing subscriptions. The Accounts page just needs a hint when `subscription_count == 0`. |
| Cloud Run job + Cloud Scheduler pattern | `terraform/cloud_run_jobs.tf` (`paused = false`, sync 02:00 / evaluate 02:30 UTC) | A third job + schedule + invoker IAM member. |
| Push click-through | `django_apps/templates/pwa/sw.js` (`notificationclick` opens `data.url`) | `reverse('finance:balances')` as the notification URL — the named route already exists. |

## Design

### Model — `finance/models.py`

New `BalanceAlert` model, shaped like a single-window
`TransactionLimit` crossed with `UserAccountPreference`:

```python
class BalanceAlert(models.Model):
    """Per user+account low-balance push alert.

    Fires once per breach episode: ``alerted_at`` is stamped when the
    notification goes out and cleared once the balance is back at or
    above ``threshold``, so a later drop alerts again.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='balance_alerts',
    )
    account = models.ForeignKey(
        Account,
        on_delete=models.CASCADE,
        related_name='balance_alerts',
    )
    threshold = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        help_text=(
            'Alert when the account balance drops below this amount '
            '(in the account currency; may be negative)'
        ),
    )
    is_active = models.BooleanField(default=True)
    alerted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When the low-balance push was last sent',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'account')
```

Notes:

- Keyed `(user, account)`, not just `account` — sharers set their own
  thresholds, matching `UserAccountPreference` and `TransactionLimit`.
- `threshold` allows negatives (overdraft alerts, e.g. "below -50").
- Threshold is interpreted in `account.currency`; no conversion.
- Run `python manage.py makemigrations` — commit the migration, never
  `migrate` (repo hard rule; CI applies it).

Also a small in-app `Notification` model — the non-push fallback
(**decided: in scope**). Push is best-effort (needs VAPID + a
subscribed browser); a durable row guarantees the user sees the
alert on their next visit even with zero subscriptions. Keep it
finance-scoped for now — a cross-app notification center can come
later if another app wants it:

```python
class Notification(models.Model):
    """In-app alert surfaced to the user on their next SPA visit."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='finance_notifications',
    )
    title = models.CharField(max_length=200)
    body = models.TextField()
    url = models.CharField(
        max_length=500,
        help_text='SPA path the notification opens, e.g. /finance/balances/'
    )
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### API — `finance/api.py`

- `AccountOut` gains `balance_alert: Optional[Decimal]` (the caller's
  threshold, null = no alert). `_account_payload` reads it from a
  prefetched `BalanceAlert` map — populate it in `account_list` and
  `balances` the same way `prefs` is built today.
- `AccountsOut` gains `push_config: PushConfigOut` (reuse the existing
  schema — vapid key, `subscription_count`, subscribe/unsubscribe
  URLs) so the bell popover can warn "enable notifications on the
  Limits page" when `subscription_count == 0` and even offer a
  subscribe button via `usePushSubscription` later.
- New schemas `BalanceAlertSaveIn {threshold: Decimal}` (ninja/
  pydantic validates; reject nothing — negatives are legal).
- New endpoints, same conventions as limits:

  ```python
  @router.post('/accounts/{account_id}/balance-alert/',
               response=MessageOut)
  def save_balance_alert(request, account_id: int,
                         payload: BalanceAlertSaveIn):
      account = get_object_or_404(
          Account.objects.for_user(request.user), pk=account_id)
      BalanceAlert.objects.update_or_create(
          user=request.user, account=account,
          defaults={
              'threshold': payload.threshold,
              'is_active': True,
              'alerted_at': None,  # reset episode on every save
          },
      )
      return {'success': True, 'message': 'Balance alert saved.'}

  @router.post('/accounts/{account_id}/balance-alert/delete/',
               response=MessageOut)
  def delete_balance_alert(request, account_id: int):
      BalanceAlert.objects.filter(
          user=request.user,
          account_id=account_id,          # for_user-scoped:
          account__in=Account.objects.for_user(request.user),
      ).delete()
      return {'success': True, 'message': 'Balance alert removed.'}
  ```

  (Exact delete scoping may use `get_object_or_404` on
  `account.balance_alerts.filter(user=…)` — keep per-user scoping
  either way.) No Django form needed — one decimal field, ninja
  validates it; a `ModelForm` would be ceremony for a single field.
- Notification endpoints (the next-login fallback):

  ```python
  @router.get('/notifications/', response=NotificationsOut)
  def notifications(request):
      """Unread in-app alerts — the SPA drains these into toasts."""
      return {'notifications': request.user.finance_notifications
              .filter(read_at__isnull=True)[:20]}

  @router.post('/notifications/read/', response=SuccessOut)
  def mark_notifications_read(request, payload: NotificationsReadIn):
      request.user.finance_notifications.filter(
          pk__in=payload.ids, read_at__isnull=True
      ).update(read_at=timezone.now())
      return {'success': True}
  ```

  `NotificationsReadIn {ids: List[int]}`; rows stay in the table
  (audit trail) — a periodic prune is optional, volumes are tiny.

### Management command — `check_balance_alerts`

New `finance/management/commands/check_balance_alerts.py`, modeled on
`evaluate_spending_limits.py`:

1. Load `BalanceAlert.objects.filter(is_active=True)
   .select_related('account', 'user')`; exit early if none.
2. Dedupe to distinct accounts — fetch each account's balance **once**
   even when several users alert on it (shared accounts):
   `client.fetch_balances_parallel([a.account_id for a in accounts])`.
3. For each account with `result['ok']` and a balance: write
   `last_balance` / `balance_updated_at` (same two
   `update_fields` as `refresh_balances`). For failures/429: log a
   warning and **skip** that account's alerts — evaluating a stale
   stored balance would false-alert.
4. Per alert on a successfully fetched account:
   `amount = Decimal(balance['balanceAmount']['amount'])`
   (guard: missing/`None` → skip; currency != `account.currency` →
   log + skip).
   - `amount < threshold` and `alerted_at is None` → create the
     in-app `Notification` row (guaranteed delivery on next login)
     **and** push `send_limit_alert(alert.user, 'Low balance', body,
     reverse('finance:balances'))` — then stamp `alerted_at`
     unconditionally: the Notification row is the record of delivery,
     push is opportunistic on top. Body like
     `"Revolut main: €38.20 — below your €50.00 alert"` (reuse the
     `_fmt_money` helper — lift it and `CURRENCY_SYMBOLS` from the
     evaluate command into `services/` or duplicate; they're 10 lines).
   - `amount < threshold` and already alerted → log only.
   - `amount >= threshold` and `alerted_at` set → clear it (episode
     over).
   - `logger.warning('BALANCE_ALERT_TRIGGERED user=%s account=%s
     balance=%s threshold=%s', …)` parity with
     `SPENDING_LIMIT_EXCEEDED`.
5. `--dry-run` flag (fetch + evaluate, no writes/pushes) for parity
   with `sync_bank_transactions`.
6. `self.stdout.write` summary: `Evaluated N alerts on M accounts:
   K triggered`.

Rate-limit note: GoCardless free-tier balance calls are daily-capped
per account (the SPA already surfaces "hit the daily API limit" on
429). One job call/day/account leaves headroom for manual
"Get latest balance" clicks — and the fetched value also refreshes
what the Balances page shows.

### Terraform — `terraform/cloud_run_jobs.tf`

Clone the `evaluate_limits_job` block as
`google_cloud_run_v2_job.check_balance_alerts_job`:

- name `check-balance-alerts`, command
  `["python", "manage.py", "check_balance_alerts"]`, same service
  account / image / 1 CPU 512Mi / `ignore_changes` lifecycle.
- Same env block — **must keep `VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`**
  (evaluate job already carries them; copy verbatim).
- `google_cloud_run_v2_job_iam_member.scheduler_invokes_balance_alerts`
  granting `roles/run.invoker` to the scheduler SA.
- `google_cloud_scheduler_job.check_balance_alerts_schedule` —
  `schedule = "0 3 * * *"` UTC so it runs after sync (02:00) and
  evaluate (02:30); `paused = false`.

The env-var block is now copy-pasted a third time — extracting it into
a `locals` map or a `dynamic "env"` block is optional cleanup, not
required.

### Frontend — Accounts.tsx bell

`frontend/src/finance/routes/Accounts.tsx`, `AccountRow` (the page is
now `fin-card` account cards — post-redesign structure, see
`accounts.css`):

- New icon button in the card-head action cluster, before the share
  icon: `btn btn-sm acct-icon-btn` + `bi-bell` when no alert is set;
  `bi-bell-fill` (accent-colored, e.g. `text-warning` or a small
  `.acct-alert-on` class) when one is. `title`/`aria-label`:
  `"Set balance alert"` / `"Balance alert: <threshold> <currency>"`.
  Toggling sets `const [alertOpen, setAlertOpen] = useState(false)`.
- Expanded: a full-width form below the card header, same pattern as
  `.acct-share-form` — add an `.acct-alert-form` class in
  `accounts.css` (margin-top + top border, `d-flex gap-2`):
  `input type="number" step="0.01"` with an `account.currency`
  suffix label ("Alert me when the balance drops below"), Save
  (`btn-primary`), a Remove button when an alert exists, and a
  `bi-x-lg` cancel. Both share and alert forms can coexist — or make
  opening one close the other; either is fine, pick whichever reads
  cleaner.
- Show the last stored balance next to the input for context
  (`account.last_balance?.balanceAmount`) — cheap, already in the
  payload.
- If `data.push_config.subscription_count === 0`, a muted hint in
  the expanded form: "No devices subscribed — enable alerts on the
  [Limits page](/limits)". (A full `PushCard` embed is possible
  since `push_config` ships the subscribe URLs — optional polish.)
- `frontend/src/finance/mutations.ts`: `useSaveBalanceAlert` /
  `useDeleteBalanceAlert` — copy `useToggleBalanceCheck` shape
  (toast `data.message`, invalidate `['finance']`).
- `frontend/src/finance/api.ts`: `BalanceAlertSaveIn`,
  `NotificationOut`, `NotificationsReadIn` aliases after
  `npm run gen:types --prefix frontend` regenerates `api-types.ts`
  (requires `manage.py openapi` or the running server producing
  `frontend/openapi.json` — check how the last regen was driven).
- Unread notifications → toasts: a small `useQuery` in `App.tsx` (or
  `FinanceNavBar`, which every route mounts) on
  `['finance', 'notifications']` → `fetchNotifications`; `onSuccess`
  (or `useEffect` on `data`) pushes each as a toast via `pushToast`
  and then `apiPost('/api/finance/notifications/read/', {ids})`.
  This is the "message on next login" fallback — no service worker
  or push subscription needed, and it also records breaches for
  push-subscribed users who missed the notification.

### Frontend — Balances.tsx badge (read-only)

`frontend/src/finance/routes/Balances.tsx`, `BalanceCard`: when
`account.balance_alert != null`, render a small read-only badge —
e.g. under the "Last updated" line or beside the `balanceType`
caption:

```tsx
<span className="badge text-bg-secondary">
  <i className="bi bi-bell-fill" /> Alert below{' '}
  {account.balance_alert} {amount?.currency}
</span>
```

No form here — editing stays on Accounts. The `balances` endpoint
returns the same `AccountOut` via `_account_payload`, so
`balance_alert` flows automatically once that endpoint populates the
alert map (listed under API above). Update `Balances.test.tsx` to
assert the badge renders only when `balance_alert` is set.

## Sequence / task list

1. `BalanceAlert` + `Notification` models + `makemigrations`
   (commit the migration).
2. `finance/api.py`: schema fields, `push_config` on `AccountsOut`,
   the two alert endpoints + the two notification endpoints.
3. `check_balance_alerts` command (+ `--dry-run`).
4. Frontend: `mutations.ts` hooks, `api.ts` types, `Accounts.tsx`
   bell + `.acct-alert-form`, `Balances.tsx` read-only badge,
   unread-notifications → toasts drain in `App.tsx`/`FinanceNavBar`.
5. Terraform: job + IAM + schedule (applies via `terraform.yml` on
   merge to main).
6. Tests — `finance/test_api.py` (endpoint contract: save/delete,
   404 on foreign account, `AccountOut.balance_alert` field,
   notifications list + mark-read), `finance/tests.py` (command:
   mock `GoCardlessClient`/`fetch_balances_parallel`; breach → one
   Notification row + one push + `alerted_at` set; second run no
   dup; recovery clears flag; fetch failure skips),
   `Accounts.test.tsx` (bell render, open form, save/remove calls),
   `Balances.test.tsx` (badge shown iff `balance_alert` set).
7. Docs: `finance/AGENTS.md` (model bullet + command bullet),
   root `AGENTS.md` repo-map line if desired.

## Edge cases / decisions

- **Episode semantics** (recommended): alert once per crossing —
  `alerted_at` set on breach, cleared on recovery. A "remind me daily
  while below" variant would instead re-send on every breach run;
  easy toggle later (`alerted_at` check removal), but noisier.
- **Failed/stale fetches**: skip evaluation entirely for that account
  rather than alerting on `last_balance` — a stale stored balance can
  be days old.
- **`balanceType`**: whatever `fetch_account_balance` prefers
  (`interimAvailable` → `interimBooked` → first) — same value the
  Balances page displays, so the alert matches what the user sees.
- **Threshold changes reset `alerted_at`** — raising the threshold
  above the current balance should alert on next run, not stay
  suppressed by an old episode.
- **Unsubscribed users**: covered by the `Notification` fallback —
  the breach always writes a row, so `alerted_at` is stamped
  unconditionally (push failure/zero subscriptions no longer
  suppresses future episodes; subscribing later isn't required for
  the alert to be seen).
- **Requisition expiry**: `fetch_balances_parallel` captures per-
  account failures (EX'd requisition → error result → skipped), no
  special handling needed.
- **Manual refresh interplay**: `POST /balances/refresh/` only writes
  `last_balance` — it does *not* evaluate alerts. That's fine for v1
  (alerts are the job's job); if instant evaluation is wanted later,
  factor the per-account evaluate step into `services/balances.py` and
  call it from both places.

## Open questions

- ~~Bell on Accounts vs. on the Balances cards?~~ **Decided**:
  editing lives on Accounts (bell + inline form, alongside the other
  per-account actions); Balances cards get a read-only
  `bi-bell-fill` badge showing the threshold — see the Balances.tsx
  section above.
- ~~Should non-push fallback exist?~~ **Decided — yes**: an in-app
  `Notification` row per breach, drained into toasts on the next SPA
  visit. Django `messages` can't reach the SPA and there's no mail
  backend configured, so a DB row + unread endpoint is the simplest
  reliable fallback (and doubles as a breach audit trail for
  push-subscribed users).
- `send_limit_alert` rename to a neutral `send_push_alert` — do it in
  the same PR or leave the name? Low risk either way.
