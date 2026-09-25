# Plan: Chrome push notifications for spending-limit alerts

**Goal:** when `evaluate_spending_limits` detects a breached
`TransactionLimit`, send the user a Web Push notification (Chrome,
works with the browser closed) in addition to the existing
`SPENDING_LIMIT_EXCEEDED` log line.

**Why Web Push (not email or in-app banner):** the PWA service worker
(`sw.js`, root scope) already exists and is registered on every page —
the main prerequisite is done. Email needs `EMAIL_*` SMTP config that
doesn't exist; an in-app banner only fires when the user opens the
site, which defeats the point of an alert.

## Design decisions

- **`pywebpush`** for sending. Small, standard, pure-Python; pinned to
  a release ≥7 days old in `requirements.txt`. VAPID for push-service
  auth (self-signed, no Google account needed beyond FCM's endpoint).
- **Subscriptions live in `finance`** — `PushSubscription` model, one
  row per browser (`endpoint` unique). Spending limits are the only
  consumer today; if other apps want push later the model/endpoint can
  move to `django_apps` without schema changes beyond a rename.
- **Dedup = per-window state on `TransactionLimit`** — two nullable
  `DateTimeField`s (`alerted_7d_at`, `alerted_30d_at`). Semantics:
  alert **once per exceedance episode** — set the flag when the
  notification is sent, clear it when spending falls back under the
  threshold so the *next* breach alerts again. Rejected alternatives:
  time-based throttle (re-alerts at arbitrary cadence) and a separate
  alert-log table (no UI to show history; YAGNI).
- **One notification per limit per run** — if both windows breach in
  the same evaluation, send a single notification naming both, and set
  both flags.
- **Opt-in via explicit button** on the limits page ("Enable spending
  alerts") — `Notification.requestPermission()` must come from a user
  gesture anyway, so no auto-prompt.
- **Graceful when VAPID keys are unset**: the limits page hides the
  button, the subscribe endpoint 400s, and the command just logs as
  today. `manage.py check`/`test` unaffected (settings default to
  `''`).

## Changes

### 1. Dependency + VAPID keys

- `requirements.txt`: add `pywebpush` (pin exact version).
- Generate a keypair once: `vapid --gen` (shipped with `py_vapid`,
  a pywebpush dependency).
- `private_settings_template.json` + `private_settings.json`: add
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
  (`mailto:...` contact).

### 2. Settings — `django_apps/settings.py`

Mirror the `ESV_KEY` pattern in all three blocks:

- GCP mode: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
  `VAPID_SUBJECT` via `get_env_str`.
- `private_settings.json` mode: same keys via
  `private_settings.get(...)`.
- Fallback block: `os.environ.get('VAPID_*', '')` — empty means
  feature disabled.

### 3. Models — `finance/models.py`

```python
class PushSubscription(models.Model):
    """A Web Push subscription for one of the user's browsers."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='push_subscriptions'
    )
    endpoint = models.URLField(max_length=500, unique=True)
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
```

Add to `TransactionLimit`:

```python
alerted_7d_at = models.DateTimeField(null=True, blank=True)
alerted_30d_at = models.DateTimeField(null=True, blank=True)
```

`python manage.py makemigrations finance` → one migration
(`CreateModel` + two `AddField`, all additive). Never `migrate`
locally.

### 4. Send helper — `finance/services/push.py` (new)

```python
def send_limit_alert(user, title, body, url):
    """Push a notification to every subscribed browser of ``user``."""
```

- Iterates `user.push_subscriptions.all()`, calls `webpush(...)` with
  `vapid_private_key=settings.VAPID_PRIVATE_KEY`,
  `vapid_claims={'sub': settings.VAPID_SUBJECT}`, JSON payload
  `{title, body, url}`.
- `WebPushException` with status 404/410 → delete the row (stale
  subscription); other statuses → `logger.warning`, keep the row.
- No-op (debug log) when `VAPID_PRIVATE_KEY` is empty.

### 5. Command — `finance/management/commands/evaluate_spending_limits.py`

Rework the breach branch:

- For each window: if `abs(spent) > threshold` — log the warning as
  today, and collect the breach if the corresponding `alerted_*_at`
  is `None`. If *not* exceeded → clear the field when set.
- After the window loop, if any new breaches: set the
  `alerted_*_at` fields to `timezone.now()`, `save(update_fields=...)`,
  and call `send_limit_alert` once per limit with a summary body, e.g.
  `Groceries on SEB: €120.00 of €100.00 in the last 7 days`, url
  `/finance/limits/`.

### 6. Endpoints — `finance/views.py` + `finance/urls.py`

Both `@login_required @require_POST`, JSON body, `JsonResponse`
(convention from `preview_rule_view`):

- `POST /finance/push/subscribe/` — body `{endpoint, keys: {p256dh,
  auth}}` → `update_or_create(user=request.user, endpoint=endpoint,
  defaults={p256dh, auth})`. 400 on missing/invalid fields or when
  `VAPID_PUBLIC_KEY` is empty.
- `POST /finance/push/unsubscribe/` — body `{endpoint}` → delete the
  user's matching row; 404 if absent.

### 7. Limits page — `finance/views.py`, `templates/finance/limits.html`,
`static/finance/js/push_subscribe.js` (new)

- `limits_view` context: `vapid_public_key=settings.VAPID_PUBLIC_KEY`,
  `push_subscriptions=request.user.push_subscriptions.count()`.
- Template: card/button "Enable spending alerts" (hidden when
  `vapid_public_key` empty), status line "Enabled on N device(s)",
  unsubscribe button. Pass config via `json_script` (same pattern as
  `get_dashboard_js_config`): public key, subscribe/unsubscribe URLs.
- JS: on click → `Notification.requestPermission()` →
  `navigator.serviceWorker.ready` → `pushManager.subscribe({
  userVisibleOnly: true, applicationServerKey:
  urlBase64ToUint8Array(vapidKey) })` → `fetch` POST with
  `X-CSRFToken`. On load, check `pushManager.getSubscription()` to
  render enabled state; unsubscribe → `subscription.unsubscribe()` +
  POST.

### 8. Service worker — `django_apps/templates/pwa/sw.js` +
`django_apps/views.py`

- Add `push` listener: parse `event.data.json()`, `event.waitUntil(
  registration.showNotification(title, {body, icon:
  '{% static "pwa/icons/icon-192.png" %}', data: {url}}))`.
- Add `notificationclick`: `clients.openWindow(notification.data.url
  || '/')`.
- **Bump `PWA_CACHE_VERSION` to `'2'`** in `views.py` — existing
  installs must pick up the new worker or pushes arrive with no
  handler.

### 9. Admin + docs

- `finance/admin.py`: register `PushSubscription` (`list_display`:
  user, endpoint truncated, created_at); add `alerted_7d_at` /
  `alerted_30d_at` to `TransactionLimitAdmin` `readonly_fields`.
- `finance/AGENTS.md`: update the `TransactionLimit` bullet (push
  alerts, per-window episode flags) and the command bullet
  (notification on breach, not just logging); note `push.py`.

### 10. Terraform + deploy runbook

- `terraform/secrets.tf`: add `VAPID_PUBLIC_KEY`,
  `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` to the `for_each` set.
- `terraform/cloud_run.tf` (service env): `VAPID_PUBLIC_KEY` only —
  the page renders it to JS.
- `terraform/cloud_run_jobs.tf` (`evaluate_limits_job` env):
  `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` — the job signs pushes. The
  sync job doesn't need them.
- Manual step before `terraform apply` (data sources require the
  secrets to exist): `gcloud secrets create VAPID_PUBLIC_KEY
  --data-file=- ...` for each — same bootstrap pattern as existing
  secrets; document in `docs/QUICKSTART.md`.
- Note: the evaluate scheduler is `paused = true` — alerts only fire
  on manual/CI job runs until it's unpaused (separate decision).

## Edge cases

- **Multiple browsers/devices** → all of the user's subscriptions get
  the push.
- **Permission revoked / subscription expired** → push endpoint
  returns 404/410 → row deleted on next send.
- **Still exceeded on the next run** → flag set → log only, no
  repeat notification.
- **Spent dips under, then breaches again** → flag cleared on the
  clean run → new notification (the point of episode semantics).
- **`VAPID_*` unset** → UI hidden, endpoint 400s, command logs only.
- **Local dev** → `localhost` is a secure context in Chrome, so
  service worker + push work on plain `runserver` (no sslserver
  needed); still requires VAPID keys in `private_settings.json`.
- **iOS Safari** → push needs the installed PWA (iOS 16.4+); works
  but untested — note only.
- **In-flight shared-category work** — orthogonal; the command's
  transaction filter (`category_assignments__user`) doesn't affect
  the alert plumbing.

## Tests (`finance/tests.py`)

- `send_limit_alert`: sends to all of the user's subscriptions (mock
  `webpush`); 410 → row deleted; 500 → warning, row kept; no keys →
  no-op.
- Command: breach → one push + flag set; second run while still
  exceeded → no second push; spend under → flag cleared; re-breach →
  pushes again. Both windows breached → exactly one push.
- `push_subscribe` endpoint: requires auth (302), saves/updates row,
  400 on missing keys and on empty `VAPID_PUBLIC_KEY`.
- `push_unsubscribe`: deletes own row, 404 for foreign/absent
  endpoint.
- Existing limit tests unaffected (new fields nullable).
