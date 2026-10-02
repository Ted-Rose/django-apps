# Security Audit — Findings & Fix Plan

Static security review of the whole codebase (all apps, settings,
URL routing, middleware, frontend JS). Each finding lists the fix
and the **regression risks** to watch for when applying it.

## Suggested implementation order

1. Low-risk, no behavior change: F2, F5, F6, F10, F12
2. Then: F1 (OAuth state — test parallel-tab scenario), F3
   (decide twister's fate), F4 (needs a dependency + rendering
   decision)
3. Last: F8 — needs a different auth mechanism (API token), not a
   decorator

---

## F1 — OAuth callback does not validate `state` (Login CSRF)

- **Severity:** High
- **Location:** `google_api/utils.py:648-761`, wired at
  `google_api/urls.py:13`
- **Issue:** `request.session['state']` is stored when the
  authorization URL is generated, but `callback()` never compares it
  to the `state` returned by Google. A fresh `InstalledAppFlow` is
  built without calling `authorization_url()`, so
  `OAuth2Session._state` is `None` and oauthlib skips validation
  entirely (`parameters.py`: `if state and params.get('state') !=
  state`). An attacker can send their own callback URL
  (`/google/callback?code=<attacker_code>&state=x`) to a victim,
  logging the victim in **as the attacker's account** (login CSRF).
- **Fix:** At the top of `callback`, compare
  `request.GET.get('state')` to `request.session.pop('state', None)`;
  abort on mismatch, before `fetch_token` and before popping
  `oauth_scopes` / `oauth_redirect_url`.
- **Potential issues:**
  - `session['state']` is a single slot; many flows write it
    (`login_view`, `gmail`, `sync_view`, `complete_task_view`, …).
    Parallel OAuth flows in two tabs → last write wins → the first
    flow's callback fails the check. Acceptable but visible; user
    retries.
  - Session-less callback hits (cookie blocked/expired) currently
    succeed; they will hard-fail. Correct, but a behavior change.

## F2 — Open redirect via unvalidated `next` parameter

- **Severity:** Medium
- **Location:** `google_api/views.py:140-152` (`login_view`),
  `google_api/utils.py:745-761` (`callback` redirect)
- **Issue:** `request.GET['next']` is stored in the session and used
  in `redirect()` unvalidated. `/login/?next=https://evil.example`
  redirects immediately (authed users) or after OAuth — phishing
  primitive.
- **Fix:** Validate with
  `django.utils.http.url_has_allowed_host_and_scheme(next_url,
  allowed_hosts={request.get_host()})`; fall back to the dashboard.
- **Potential issues:**
  - Some flows store a **view name** (`'google_tasks:dashboard'` in
    `sync_view`, `complete_task_view`, etc.), not a URL — it fails
    URL validation. Keep the dashboard fallback so those flows still
    land correctly.
  - Test with the real `.run.app` hostname; `get_host()` relies on
    the Host header/`SECURE_PROXY_SSL_HEADER` chain.

## F3 — Unauthenticated `/text-to-audio` writes to GCS

- **Severity:** Medium
- **Location:** `google_api/views.py:155-184`,
  `google_api/urls.py:12`
- **Issue:** No `@login_required`. Anyone can synthesize arbitrary
  text to MP3, upload to `GCS_AUDIO_BUCKET`, and get a 7-day signed
  URL — storage/egress cost abuse + hosting generated audio on our
  infra. (Filename path traversal is already sanitized at
  `utils.py:137-141`.)
- **Fix:** `@login_required` + rate limiting.
- **Potential issues:**
  - **Breaks `twister.html:187`** — it fetches this endpoint from
    the *unauthenticated* `twister` page. Either accept logged-in-
    only audio for twister, or protect `twister` too.
  - `gmail.html:413` caller is unaffected (page is behind
    `google_auth_required`).

## F4 — Scraped third-party HTML rendered via `|safe` (XSS)

- **Severity:** Medium
- **Location:** `single_pages/views.py:32`,
  `single_pages/templates/blog_proxy_template.html:18`
- **Issue:** `content = str(soup)` dumps the entire spoki.lv page —
  scripts, event handlers, forms — unescaped into our origin. Any
  injected/compromised upstream content executes against visitors
  with access to site cookies.
- **Fix:** Sanitize with `bleach`/`nh3` (allowlist), or extract only
  the article text node.
- **Potential issues:**
  - Sanitization strips scripts/iframes (good) but also legit
    embeds; relative URLs (`src="/img/..."`) already resolve against
    our domain and 404.
  - Removing `|safe` without sanitization renders inert text —
    safe but useless. Real question: is this feature worth keeping?
  - Note: `bleach` is deprecated upstream; `nh3` is the maintained
    alternative.

## F5 — Missing cookie/transport security flags

- **Severity:** Medium
- **Location:** `django_apps/settings.py` (settings absent)
- **Issue:** `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`,
  `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS` never set — in prod
  session/CSRF cookies lack the `Secure` flag; no HSTS.
- **Fix:** Set them in the `IS_GCP_ENVIRONMENT` branch only.
- **Potential issues:**
  - **Must not apply unconditionally** — `SESSION_COOKIE_SECURE`
    kills local dev over `http://127.0.0.1:8000` (session cookies
    won't be set). GCP-branch only.
  - `SECURE_SSL_REDIRECT` is safe *because* `SECURE_PROXY_SSL_HEADER`
    is already set; verify nothing internal hits the service over
    plain HTTP.
  - HSTS is cached by browsers for the full duration — start small
    (`3600`), not `31536000`; skip `includeSubDomains`.

## F6 — `OAUTHLIB_INSECURE_TRANSPORT` enabled unconditionally

- **Severity:** Low
- **Location:** `google_api/utils.py:38`
- **Issue:** `os.environ.setdefault('OAUTHLIB_INSECURE_TRANSPORT',
  '1')` runs at import in all environments, disabling oauthlib's
  HTTPS enforcement in production.
- **Fix:** Gate on local-dev detection.
- **Potential issues:**
  - Set at module import; `settings` is already imported in the
    module so gating works — but `private_settings.json` mode can
    have `DEBUG=False` locally, which would silently break local
    OAuth over HTTP. Gate on `BASE_URL.startswith('http://')`, not
    `DEBUG` alone.

## F7 — `escapeJs()` bypassable → stored XSS in task creation

- **Severity:** Low (mostly self-XSS; elevates if titles ever become
  attacker-influenced, e.g. Gmail-sourced tasks)
- **Location:**
  `google_tasks/static/google_tasks/js/create_task.js:284-286`
  (used at `:168`)
- **Issue:** `escapeJs` only escapes `'`/`"`. `\"` does NOT prevent
  HTML attribute termination — the `"` literally ends the
  `onclick="..."` attribute before JS parses it. Title
  `" onmouseover="alert(1)` injects a new handler. `label.color`
  (`:120`) is interpolated unescaped into `style=` (CSS injection).
- **Fix:** Replace inline `onclick`+interpolation with
  `addEventListener` and `data-*` attributes, or HTML-attribute-
  escape values.
- **Potential issues:**
  - Refactor of `create_task.js` generated-HTML block; risk of
    breaking the create-task UX.
  - Check for duplicated `escapeJs`/inline-handler patterns in other
    dashboard JS before removing.

## F8 — `bible_research` endpoints unauthenticated (quota abuse)

- **Status:** Resolved by removal — the `bible_research` app was
  deleted (see `DEPRECATE_TV_ARCHIVE_BIBLE_RESEARCH.md`).
- **Severity:** Low
- **Location:** `bible_research/views.py:8-42`
- **Issue:** `/bible/verses` and `/bible/` proxy `api.esv.org` with
  our server-side `ESV_KEY` — anyone can exhaust the rate limit /
  generate audio.
- **Fix:** NOT `@login_required` — see below. Use an API token
  (shared secret header) or throttle by IP; cache per passage.
- **Potential issues:**
  - **Biggest regression risk.** `CORS_ALLOWED_ORIGINS` includes
    `https://reactive-bible.vercel.app` — that frontend almost
    certainly consumes `/bible/verses`. Cross-origin `fetch` won't
    send the session cookie (`SameSite=Lax`, no
    `credentials: 'include'`), so session auth cannot work — the
    endpoint would just break for the real consumer.

## F9 — `tv_archive` list endpoint: unauthenticated, unvalidated input

- **Status:** Resolved by removal — the `tv_archive` app was deleted
  (see `DEPRECATE_TV_ARCHIVE_BIBLE_RESEARCH.md`).
- **Severity:** Low
- **Location:** `tv_archive/views.py:23-51`
- **Issue:** No `@login_required` (public listing — possibly
  intentional). `rating_value__gte`/`ratio`/`start_date` with
  non-numeric values raise `ValidationError` → unhandled 500s. No
  injection (fixed field names, parameterized values).
- **Fix:** Coerce/validate GET params (a `Form` works); optionally
  require auth.
- **Potential issues:** Low risk; auth is a product decision.

## F10 — Refresh token duplicated into the session store

- **Severity:** Low
- **Location:** `google_api/utils.py:679-684`
- **Issue:** `request.session['google_credentials']` stores the
  long-lived refresh token in the session table in addition to
  `GoogleOAuthCredentials` — doubles at-rest exposure.
- **Fix:** Stop writing it.
- **Potential issues:** Verified safe — the key is **written but
  never read** in code (only referenced in `README.md`/`AGENTS.md`
  docs, which go stale).

## F11 — Overly broad `ALLOWED_HOSTS` wildcards

- **Severity:** Low
- **Location:** `django_apps/settings.py:115-123`
- **Issue:** `.vercel.app`, `.appspot.com`, `.run.app` accept Host
  headers for *any* tenant on those platforms.
- **Fix:** Restrict to actual service hostnames.
- **Potential issues:**
  - Must keep the exact Cloud Run hostname
    (`django-apps-<hash>-ew3.run.app`) — dropping `.run.app` without
    it takes the site down.
  - `.vercel.app` is legacy per AGENTS.md, but if a Vercel deploy
    still serves traffic, removing it breaks that.

## F12 — Internal error details returned to clients

- **Severity:** Low
- **Location:** `google_tasks/views.py:1128,1189,1688,1756`;
  `bible_research/views.py:21`; `google_api/views.py:176`
- **Issue:** `{'error': str(e)}` returns raw exceptions (incl.
  upstream API bodies — `get_word.py:50` embeds `resp.text`).
- **Fix:** Generic client message; details stay in logs.
- **Potential issues:** `bible/verses` `str(e)` surfaces ESV API
  errors the frontend may show users — blanket generic messages
  degrade UX/debuggability. Keep user-meaningful errors, strip
  internals.

## F13 — OAuth tokens stored in plaintext (informational)

- **Severity:** Low
- **Location:** `google_api/models.py:16-24`
- **Issue:** `access_token`/`refresh_token` plaintext TextFields —
  anyone with DB read access can impersonate users against
  Gmail/Tasks.
- **Fix:** Field-level encryption (`django-cryptography`) if DB
  exposure is a concern.
- **Potential issues:** Key management + existing-row migration
  overhead; reasonable to skip for a personal app.

---

## Verified clean — no action needed

- **SQL injection:** no `.raw()`, `.extra()`, `connection.cursor()`,
  `RawSQL`, `ExpressionWrapper`; all filters use static field names.
- **ORM `**kwargs` misuse:** none.
- **IDOR/BOLA:** every `get_object_or_404` scopes `user=`; finance
  uses `for_user()`/`owner=`; sync keys `update_or_create` on
  `(user, remote_id)`.
- **Mass assignment:** no DRF; ModelForms use explicit `fields`.
- **CSRF:** middleware active, zero `@csrf_exempt`, mutations
  `@require_POST`.
- **Secrets:** all from env/`private_settings.json` (gitignored);
  `DEBUG=False` forced in GCP mode. Caveat: the
  `'dev-only-insecure-secret-key'` fallback would ship a predictable
  key if ever deployed with no env/file config.
- **Deserialization:** no `pickle`/`yaml.load`/`eval`/`exec`.
- **TLS:** no `verify=False`; `tv_archive` uses `CERT_REQUIRED`.
- **Template escaping:** autoescape on; single `|safe` = F4.
