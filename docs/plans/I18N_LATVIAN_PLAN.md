# i18n Plan — English/Latvian for the whole site

> **Status**: Plan + catalogs complete (this session produced the
> plan and the `frontend/src/*/locales/{en,lv}.json` catalogs).
> Implementation is a follow-up — no `.tsx`/`.py`/template files were
> modified and no migration was generated here.

Goal: full English + Latvian i18n. `USE_I18N=True` is already set but
nothing else exists: no `LocaleMiddleware`, no `.po` files, no
`{% trans %}`, no i18n library in `frontend/package.json`.

## 1. Inventory — where user-facing English lives

### 1.1 React SPA UI copy (`frontend/src/`)

Hardcoded strings in ~65 non-test `.ts`/`.tsx` files:

- `frontend/src/finance/` — 26 files (7 routes, 15 components,
  `mutations.ts`, `App.tsx`). ~85 grep hits for
  `pushToast|aria-label|placeholder=|title=`; plus JSX text nodes,
  nav labels (`FinanceNavBar.tsx`: Home/Connect Bank/Accounts/
  Transactions/Categories/Balances/Limits/Rules/Logout).
- `frontend/src/tasks/` — 28 files (8 routes, 7 components,
  `mutations.ts`). ~38 hits; nav/sort labels in `TaskNavBar.tsx`
  (Order Desc/Asc, Created/Due, Completed First/Last …).
- `frontend/src/shared/` — `NavBar`, `BurgerMenu`, `Dropdown`,
  `Modal`, `Toasts`, `CollapsibleCard`, `toasts.ts`,
  `api/errors.ts` (`'Could not reach the server. Check your
  connection.'` fallback in `errorDetail`).
- `frontend/src/*/mutations.ts` — client-composed toast prefixes:
  `Sync failed: …`, `Failed to <verb> <noun>: {detail}` (~30 sites in
  finance, ~20 in tasks). The success path toasts `data.message`
  **verbatim** — see §4.

Locale-sensitive formatting currently using the browser default
locale implicitly:

- `Balances.tsx:150` — `updatedAt.toLocaleString()` (no locale arg).
- `TransactionTable.tsx:445` — `bookingDate.toLocaleDateString()`.
- `Limits.tsx:183` — `as_of` date via `toLocaleDateString`.
- Money formatting in `MoneyText.tsx` / table cells — audit for
  currency display; move to `Intl.NumberFormat`.

### 1.2 API response prose (`{'success','message'}` / `{'error','detail'}`)

The SPA toasts `data.message` and `errorDetail(error)` verbatim, so
every one of these is user-facing:

**`finance/api.py`** (~32 prose sites):

| Endpoint | Strings |
|---|---|
| `GET /institutions/` | 502 `Could not load institutions: {exc}` |
| `POST /connect/` | 502 `Could not start bank link: {exc}` |
| `POST /accounts/{id}/toggle-balance-check/` | `Account included in / excluded from the balance check.` |
| `POST /accounts/{id}/share/` | `Please provide a username.`; `Unknown or invalid username.`; `Account shared with {username}.` |
| `POST /accounts/{id}/balance-alert/` (+`/delete/`) | `Balance alert saved.` / `removed.` |
| `POST /transactions/sync/` | `No linked bank accounts to sync.`; `Synced {c} new transactions ({u} updated).`; `Synced {c} new transactions, but {f} account(s) failed.`; per-account `SyncAccountOut.detail` (`'Requisition status is {status} (not LN) — bank must be relinked.'`, `str(exc)[:200]` passthrough) |
| `POST /balances/refresh/` | `No accounts are included in the balance check.`; `Updated {u} balance(s)`; `{r} hit the daily API limit — showing last stored balance`; `{f} failed to fetch` |
| `POST /limits/save/` | `Could not save limit: {errors}`; 409 `A limit already exists for this account and category.`; `Spending limit updated.` / `saved.` |
| `POST /limits/{id}/delete/` | `Spending limit deleted.` |
| `POST /rules/save/`, `/delete/`, `/move/`, `/apply/` | `Could not save rule: {errors}`; `Rule saved/deleted/moved; {n} transaction(s) recategorized.`; `{n} transaction(s) recategorized.` |
| `POST /rules/preview/` | `{'error': 'Pick a category to preview.'}` from `services/rules.py` |
| `POST /categories/save/`, `/delete/` | `Category name is required.`; `Category "{name}" saved.`; `Category deleted; {n} …` |
| `POST /push/subscribe/`, `/unsubscribe/` | `Push notifications are not configured.`; `Missing or invalid subscription fields.`; `Subscription not found.` |

**Server-composed display strings also returned by `finance/api.py`**
(NOT `message` fields — data that renders directly):

- `periods[].label` — `'Last 7 days'`, `'Last 30 days'`, `'Last 90
  days'`, `'Last 365 days'`, `'This month'`, `'Last month'`, `'All
  time'` (category overview presets).
- `overview_months[].label` — `strftime('%B %Y')` English month names.
- `window_stats[].label` / `.period_text` — `'7 days'`, `'30 days'`,
  `'This month'`, `'the last 7 days'`, `'this month'`, history
  `'%b %Y'` (all composed in `finance/services/limits.py`).
- `rules` choice labels — `MATCH_TYPES` (`Contains`, `Equals`,
  `Starts with`, `Ends with`), `COUNTERPARTY_SCOPES` (`Debtor or
  creditor`, `Debtor (sender)`, `Creditor (receiver)`),
  `OPERATORS` — returned as `{'value','label'}` via `_choices()`.
- `'Uncategorized'` literal (`category_overview` row fill),
  `'#6c757d'` color default (not text).
- `TransactionLimitForm` labels (`Limit per 7 days` …) —
  currently unused by the SPA (form is client-side) but
  `_flatten_errors` surfaces Django form errors verbatim, including
  custom `'Set at least one pattern to match on.'` plus built-in
  messages (Django core ships `lv` translations for built-ins).

**`google_tasks/views.py`** (~24 error strings surfaced through
`api.py`'s `_adapt` as `{error: slug, detail: <this text>}`):
`'Invalid JSON'`, `'updates must be a non-empty list'`,
`'Too many updates (max {n})'`, `'Each update must be an object'`,
`'Each update requires a task_id and a position'`, `'Duplicate task
IDs'`, `'Duplicate positions'`, `'Invalid task IDs'`,
`'position_conflict'` (already a code), `'No credentials found'`
(mapped to `google_reauth` — never displayed), `'Failed to complete
task'`, `'Failed to uncomplete task'`, `'Failed to create task in
Google Tasks'`, `'Title cannot be empty'` (×2), `'Invalid label
IDs'`, `'{field} must be a finite number'`, plus four `str(e)`
passthroughs (exception text — see §4 note).

**`finance/views.py`** (`requisition_callback`, `messages.*`):
`'No pending bank connection found.'`,
`'Could not verify bank link: {exc}'`,
`'Bank account connected.'`, + a warning (rate-limit variant).

**`django_apps/api.py`** fallbacks: `'Not Found'`,
`'Operation failed'`, `'unauthenticated'`, `error_slug()` codes
(already machine-readable — good).

**`google_api/views.py`**: `burger_menu_items` labels built in
Python (`'Home'`, `'Tasks'`, `'Logout ({email})'`) — rendered by
`burger_menu.html`.

### 1.3 Job-generated text (no request context)

- `finance/management/commands/evaluate_spending_limits.py`
  `_send_alert`: title `'Spending limit exceeded'`; body lines
  `'{scope} on {account}: {spent} of {threshold} in {period_text}'`
  with scope `'All spending'` when no category; `period_text`/`label`
  from `services/limits.py` (`'the last 7 days'` etc.).
- `finance/management/commands/check_balance_alerts.py` `_notify`:
  title `'Low balance'`; body `'{name}: {amount} — below your
  {threshold} alert'`; writes a `Notification` row AND pushes via
  `send_limit_alert` (title/body/url).
- `fmt_money` (`services/money.py`) — `€12.34` symbol-prefix format;
  fine for both locales (note: Latvian convention would put the
  symbol after the amount; acceptable, flag for later polish).

### 1.4 Django templates (~45 strings, 10 files) — OUT OF SCOPE

Decided: legacy templates are **not translated** in this rollout
(SPA + jobs only). Inventory kept here for a possible later pass.

| File | Strings |
|---|---|
| `django_apps/templates/home.html` | ~15 (hero, 6 card titles + descriptions, navbar brand) |
| `components/burger_menu.html` | `aria-label="Toggle menu"` (item labels come from views) |
| `pwa/offline.html` | ~4 (`You're offline`, body copy, `Retry`, title) |
| `pwa/head.html` | none (meta only) |
| `spa_shell.html` | `Loading React app…`, manifest-missing diagnostic, `<html lang="en">`, title suffix `Tedis's Tools` |
| `google_api/templates/gmail.html` | ~12 (Gmail to Audio, query field, Body:, buttons) |
| `tv_archive/templates/content_list.html` | ~12 filter labels + `Filter`, `No content available` |
| `bible_research/…/passage_form.html` | ~7 (Audio Player, Submit, Play, Pause, Jump 5s Back/Forward, Toggle Repeat) |
| `single_pages/blog_proxy_template.html` | 2 error strings |
| `single_pages/twister.html` | **already Latvian** — stays as-is (decided: no rework) |

### Never translate (user data / developer-facing)

- GoCardless payloads: transaction `remittance_information`,
  `counterparty`/`debtor`/`creditor` names, institution names, IBANs.
- User-owned data: `Category.name`, `TaskLabel` names, task titles/
  notes, account `display_name`, usernames.
- Log messages (`SPENDING_LIMIT_EXCEEDED`, `BALANCE_ALERT_TRIGGERED`,
  all `logger.*`), `self.stdout.write` summaries, exception details,
  comments, `help_text` (admin-facing; translate only if admin LV is
  wanted — skip).

## 2. Frontend — react-i18next

### Libraries (`frontend/package.json` dependencies)

- `i18next` + `react-i18next` (runtime).
- `i18next-browser-languagedetector` — used ONLY for the
  `navigator.language` fallback step; the stored pref wins (see §3).
- No HTTP backend: catalogs are bundled as static imports (below).
- Dev: `i18next-parser` (key extraction audit), optional
  `eslint-plugin-i18next` (`no-literal-string`).

### Init — `frontend/src/shared/i18n.ts` (new)

One shared i18next instance; each entry's `main.tsx` calls
`initI18n(language, namespaces)` before `createRoot`:

```ts
i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: { en: {...}, lv: {...} },   // per-entry static imports
  lng: bootstrapLanguage(),              // stored pref → detector → 'en'
  fallbackLng: 'en',
  ns: ['common', entryNs],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});
```

`bootstrapLanguage()` = `useBootstrap().language` →
`localStorage('lang_override')` (dev convenience) →
`navigator.language` (detector) → `'en'`.

### Catalog layout (already generated this session)

```
frontend/src/shared/locales/{en,lv}.json   # namespace 'common'
frontend/src/finance/locales/{en,lv}.json  # namespace 'finance'
frontend/src/tasks/locales/{en,lv}.json    # namespace 'tasks'
```

Static imports per entry keep Vite code-splitting working — the
tasks bundle never ships finance strings, and both languages ship in
each bundle (a few KB each), so a runtime `changeLanguage('lv')` is
instant with no fetch. This satisfies "lazy loading" at the app
boundary without i18next-http-backend (which would also fight the
PWA service worker's cache). `useTranslation('finance')` in
components; `t('common:loading')` for shared keys.

### Usage patterns

- Text: `const { t } = useTranslation('finance'); t('transactions.sync')`.
- JSX with markup: `<Trans i18nKey="..." components={{b: <b/>}}/>`.
- Interpolation: `t('sync.synced', {created, updated})` →
  `"Synced {{created}} new transactions"`.
- Plurals: i18next JSON v4 format — keys `key_zero`, `key_one`,
  `key_other` for `lv`; `key_one`/`key_other` (or just `key_other`)
  for `en`. Powered by `Intl.PluralRules` internally — verify
  `compatibilityJSON: 'v4'` so `lv` gets its three categories.
- Server prose: `t(`server:${code}`, params)` with `message` as
  fallback (see §4).

### Numbers/dates — `frontend/src/shared/format.ts` (new)

Replace bare `toLocaleString()`/`toLocaleDateString()` with helpers
bound to `i18n.language`:

```ts
export const fmtMoney = (n, currency) =>
  new Intl.NumberFormat(i18n.language, {style:'currency', currency}).format(n);
export const fmtDate = (d) =>
  new Intl.DateTimeFormat(i18n.language, {dateStyle:'medium'}).format(d);
```

Note: `lv` number format uses comma decimals / space thousands —
`Intl` handles it; do NOT hand-format. Currency amounts keep the
transaction's own currency (data), only separators/grouping localize.

## 3. Language preference — stored per user

**Decision: a `UserSettings` model in the `django_apps` package**
(OneToOne `user`, `language` CharField choices `en`/`lv`, default
`'en'`), not a JSON settings blob.

Justification:

- The pref must be server-side and per-user (cron jobs render push
  text for a user with no request). Session/cookie alone can't do
  that — a DB row is required either way.
- No existing model is a fit: `finance.UserAccountPreference` is
  per-account; `google_api` credentials are Google-scoped. Adding
  `language` to either couples unrelated domains.
- A dedicated model beats "JSON settings field on some model"
  because there is no such model — you'd still be creating one. A
  typed `CharField` gets choices validation, admin visibility and
  cheap future columns (timezone, theme).
- `django_apps` is the project package (not in `INSTALLED_APPS`
  today). Add `'django_apps'` to `INSTALLED_APPS`, create
  `django_apps/models.py` + `makemigrations django_apps` — one small
  migration the user commits. `app_label` = `django_apps`; no
  `apps.py` needed (default config).

### Plumbing

- `spa_shell()` adds `'language': user_settings_language(request.user)`
  to the `bootstrap` dict (helper in `django_apps/models.py` or
  `utils.py`: `getattr(user, 'settings', None).language or 'en'` —
  use `get_or_create`-free read so anonymous/legacy users work).
- Update endpoint: new `django_apps/me.py` ninja `Router` mounted
  `api.add_router('/me/', me_router)` in `django_apps/urls.py`:
  - `GET /api/me/` → `{username, language}` (lets the SPA re-sync
    without a page reload),
  - `PATCH /api/me/` `{language}` → validates against `LANGUAGES`,
    saves, **sets the default Django language cookie**
    (`django_language`) on the response. Templates are out of scope
    so no `LocaleMiddleware` is added — the cookie is cheap
    future-proofing (and gives `lv` users a Latvian Django admin for
    free if the middleware is ever enabled).
- Fallback chain: stored pref → `navigator.language` → `'en'` (SPA
  only — nothing Django-rendered is localized in this rollout).

## 4. API prose → `code` + `params`

Contract change: every `{'success','message'}` / `{'error','detail'}`
response gains optional `code` (snake_case slug) and `params` (dict
of interpolation values). The SPA maps `code → i18next key` in a
`server` namespace; **English `message`/`detail` stays as fallback**
during transition and for unmapped codes.

```json
{"success": true,
 "message": "Synced 3 new transactions (12 updated).",
 "code": "transactions.synced",
 "params": {"created": 3, "updated": 12}}
```

- `mutations.ts` becomes
  `pushToast(data.code ? t(`server:${data.code}`, data.params) : data.message)`.
- `errorDetail()` in `shared/api/errors.ts` gets the same
  `code`-first treatment for `{error, detail, code}` bodies.
- Endpoints to convert — all §1.2 sites. `finance/api.py`: 15
  mutation endpoints + 2 read-endpoint 502s + `_flatten_errors` (wrap
  as `code: 'form_invalid'` + keep `detail` raw; per-field codes are
  over-engineering). `google_tasks/views.py`: ~20 error sites —
  give each a code in `views.py`; `_adapt` must pass `code`/`params`
  through (its `extra` splat already does for payloads that carry
  them; the `{'success': False}` path needs `code` lifted into the
  uniform body). `django_apps/api.py` slugs are already codes —
  add `code` aliasing `error` for uniformity (or just treat `error`
  as the code; decide once, document it).
- `str(e)` passthroughs in `google_tasks/views.py` (4 sites): do
  NOT translate exception text — give them `code:
  'operation_failed'` and keep `detail: str(e)` as English-only
  fallback/diagnostic.
- Choice labels (§1.2): keep `value`/`label` but the SPA renders
  `t(`finance:rules.matchTypes.${value}`)`; `overview_months` returns
  `value: 'YYYY-MM'` already — format client-side via
  `Intl.DateTimeFormat(lang, {month:'long', year:'numeric'})`;
  `periods[].label` gains a stable `key` field (`last_7d` …) or the
  SPA maps on `(date_from,date_to)` — prefer adding `key`.
  `window_stats[].label`/`period_text` → add `key` (`d7`, `d30`,
  `monthly`) in `services/limits.py`; `'Uncategorized'` → SPA maps
  the null-category case itself (remove the literal or keep as
  fallback).
- `openapi.json` must be regenerated (`manage.py
  export_openapi_schema`) + `npm run gen:types` so `code`/`params`
  reach `api-types.ts`.

## 5. Job/server-side strings — Django gettext

`LocaleMiddleware` never runs for cron jobs; wrap rendering in
`translation.override`:

```python
from django.utils import translation

def _send_alert(self, limit, breaches):
    lang = user_language(limit.user)  # 'lv' | 'en'
    with translation.override(lang):
        title = _('Spending limit exceeded')
        lines = [...]
```

- `services/limits.py` `Window.label`/`period_text`: these feed BOTH
  the API (§4 → keys) and the alert body (gettext). Split cleanly:
  keep a `key` on each window for the API, and compose alert text
  with `gettext`/`npgettext` at the call site rather than reusing
  `label` — the alert sentence needs grammar context the bare label
  can't give (Latvian cases: "pēdējās 7 dienās", not "the last 7
  days" templated word-by-word).
- `fmt_money` stays (symbol prefix acceptable), or switch to
  `django.utils.formats`/`babel` later — out of scope.

**gettext infra** (needed for job strings even though templates are
out of scope):

- `settings.py`: `LANGUAGES = [('en','English'),('lv','Latvian')]`,
  `LOCALE_PATHS = [BASE_DIR / 'locale']`. No `LocaleMiddleware` —
  nothing request-rendered is localized (see §6).
- `locale/en` + `locale/lv` `.po` files hold the job/msgid strings
  (`makemessages` also sweeps views if the `messages.*` calls in
  `finance/views.py` get wrapped — optional).
- `makemessages -l lv` needs GNU gettext locally:
  `brew install gettext` on macOS (not on PATH by default;
  `brew link --force gettext` or call the keg path). Extraction can
  also be hand-maintained — the msgid set is ~10 strings.

**`msgfmt` is NOT available in either build target**: the Dockerfile
(`python:3.12-slim`, no `gettext` apt package) and Vercel's build
image both lack it, and local macOS doesn't have it either — so
committing `.mo` binaries is fragile. Recommended: pure-Python
compile step that runs identically on both targets:

- add `polib` to `requirements.txt`;
- add a `compile_po` task in `django_apps/console_tasks/build.py`
  (or `tools/compile_po.py`): for each `locale/*/LC_MESSAGES/*.po`,
  `polib.pofile(p).save_as_mofile(mo_path)`;
- call it in `build_files.sh` (before `collectstatic`) and in the
  Dockerfile (same block as `collectstatic`, which already has a
  dummy `private_settings.json` for settings import — no env needed);
- `.gitignore` `**/*.mo`; commit only `.po` files.
  (Alternative: `apt-get install gettext` in the Dockerfile + a
  Vercel-specific step — rejected: two mechanisms to keep in sync.)

**`Notification` rows: pre-rendered gettext text (recommended)**, not
`kind`+`params` JSON. Reasons:

- The row is documented as "the record of delivery" — it should
  mirror the push payload verbatim; storing rendered text keeps that
  audit property.
- Zero migration: `title`/`body`/`url` columns unchanged,
  `NotificationOut` unchanged, `App.tsx` toast drain unchanged.
- Trade-off (accepted): rows freeze in the language active at send
  time; a user who switches later sees old notifications in the old
  language. Given ~daily cron volume and audit semantics this is
  fine.
- The alternative (`kind`+`params` columns + client-side key map)
  costs a migration, a `NotificationOut` schema change, a frontend
  kind→key registry and dual render paths for legacy rows — only
  worth it if notifications become interactive/multi-channel later.
  Revisit then.

## 6. Django templates — OUT OF SCOPE

Decided: no `{% trans %}`/`{% blocktrans %}` pass on the remaining
templates (§1.4), no `LocaleMiddleware`, no `makemessages` template
sweep. `twister.html` stays Latvian-only as-is — it is not reworked
to use `{% trans %}` either. Consequences:

- The site renders English on every Django-rendered page regardless
  of the stored pref; only the two SPAs and job-generated alerts
  localize.
- `spa_shell.html`'s `<html lang="en">` may optionally be set from
  the bootstrap language (one-line change, no gettext needed) for
  a11y correctness — nice-to-have, not required.
- View-side Python labels (`google_api/views.py` burger items,
  `finance/views.py` `messages.*`) stay English. If a template pass
  ever happens, wrap them with `gettext_lazy` then.
- Django-side date localization (`formats.py`/`{% localize %}`) is
  explicitly **not** wanted — client-side `Intl` covers all
  date/number rendering that matters.

## 7. Language switcher UI

- `frontend/src/shared/components/LanguageSwitcher.tsx`: EN/LV
  toggle in `NavBar.tsx` (both apps get it via the shared nav).
  On change: `PATCH /api/me/` → `i18n.changeLanguage(code)` →
  update `localStorage` override → invalidate React Query caches
  that embed server-rendered labels (`['finance']` queries carrying
  `periods`/`window_stats` labels until §4 keys land).
- Django-rendered pages stay English (templates are out of scope) —
  the `django_language` cookie the PATCH sets is inert until/unless
  `LocaleMiddleware` is ever added.
- Dev shortcut during rollout: `?lang=lv` param honored by
  `bootstrapLanguage()` before the switcher ships.

## 8. Migration order (English keeps working at every step)

0. **This session** — plan + catalogs (`locales/*.json`) committed.
1. **Deps + pref infra** — `npm add i18next react-i18next
   i18next-browser-languagedetector`; `pip install polib` +
   requirements; `UserSettings` model + `makemigrations`; `/api/me/`;
   bootstrap `language`; settings (`LANGUAGES`, `LOCALE_PATHS`);
   `compile_po` in both builds. No UI change
   yet — everything still renders English.
2. **Shared i18n init + `common` namespace** — `shared/i18n.ts`,
   wire into both `main.tsx`, convert `shared/` components and
   `errorDetail` fallback. `?lang=lv` dev override works.
3. **Finance SPA** — one route at a time (Accounts → Transactions →
   Balances → Limits → Rules/Categories → Connect), each a separate
   PR-able commit; mutations map `code`/`message` (fallback keeps
   toasts working before §4 lands).
4. **Tasks SPA** — same pattern (Dashboard → list views → modals →
   mutations).
5. **API codes** — add `code`/`params` server-side + `server`
   namespace mapping; regenerate `openapi.json`/`api-types.ts`.
6. **Jobs gettext** — `evaluate_spending_limits`,
   `check_balance_alerts` under `translation.override`; `locale/lv`
   `.po` + `compile_po` verified in both builds.
7. **Language switcher** — shared `NavBar` + a language row wherever
   settings UI lands.
8. **Cleanup** — keep the `?lang=` override (harmless), drop
   `message` fallbacks once codes are proven (optional),
   `PWA_CACHE_VERSION` bump.

## 9. Testing

- **Vitest**: `src/test/setup.ts` initializes i18next with the real
  catalogs synchronously (`initImmediate: false`); components assert
  on English defaults; add a per-namespace "key parity + plural
  forms" unit test (load en+lv JSON, diff key sets — the same check
  used to generate the catalogs). A few components get an `lv`
  render smoke test.
- **Django `TestCase`**: `/api/me/` PATCH validation;
  `{'code', 'params'}` present on mutation responses;
  `translation.override('lv')` unit test asserting the
  `check_balance_alerts` body string composes (assert a known Latvian
  substring); `compile_po` task produces parseable `.mo`.
- **Playwright** (`frontend/tests/e2e/`): smoke spec — `?lang=lv`
  load of `/finance/` and `/tasks/` asserts 2–3 known Latvian labels;
  switcher PATCH round-trip.
- **Regression guards**: `i18next-parser` config
  (`i18next-parser.config.js`) run in CI/`npm run i18n:check` — fails
  when a `t('…')` key has no catalog entry or an orphan key exists;
  `eslint-plugin-i18next` `no-literal-string` at `warn` on JSX-only
  scopes (attributes like `aria-label`/`placeholder` included) —
  keep at `warn`, not `error`, during the route-by-route rollout.

## 10. File list

### Create

```
frontend/src/shared/i18n.ts
frontend/src/shared/format.ts
frontend/src/shared/components/LanguageSwitcher.tsx
frontend/src/shared/locales/{en,lv}.json      # done this session
frontend/src/finance/locales/{en,lv}.json     # done this session
frontend/src/tasks/locales/{en,lv}.json       # done this session
frontend/i18next-parser.config.js
django_apps/models.py                          # UserSettings
django_apps/me.py                              # /api/me/ router
django_apps/migrations/0001_initial.py         # via makemigrations
locale/en/LC_MESSAGES/django.po                # job strings only
locale/lv/LC_MESSAGES/django.po
django_apps/console_tasks/build.py::compile_po # or tools/compile_po.py
```

### Modify

```
django_apps/settings.py      # LANGUAGES, LOCALE_PATHS,
                             # INSTALLED_APPS += django_apps
django_apps/urls.py          # api.add_router('/me/', me_router)
django_apps/views.py         # bootstrap['language']
finance/api.py               # +code/params everywhere; key fields on
                             # periods/overview_months/window_stats;
                             # drop 'Uncategorized' literal
finance/services/limits.py   # window key field; gettext period_text
finance/services/rules.py    # {'error': …} → code
finance/forms.py             # gettext on custom ValidationError
finance/management/commands/evaluate_spending_limits.py  # override()
finance/management/commands/check_balance_alerts.py      # override()
google_tasks/views.py        # codes on ~20 error sites
google_tasks/api.py          # _adapt passes code/params through
django_apps/api.py           # document error==code equivalence
frontend/package.json        # +i18next, react-i18next,
                             #  i18next-browser-languagedetector,
                             #  i18next-parser, eslint-plugin-i18next
frontend/src/finance/**      # t()/Trans/Intl sweep per route
frontend/src/tasks/**        # same
frontend/src/shared/**       # NavBar/BurgerMenu/Dropdown/Modal/Toasts
frontend/src/test/setup.ts   # i18n test init
frontend/openapi.json        # regen via export_openapi_schema
requirements.txt             # +polib
Dockerfile                   # compile_po step in collectstatic block
build_files.sh               # compile_po before collectstatic
.gitignore                   # **/*.mo
docs/plans/I18N_LATVIAN_PLAN.md  # this file
```

`makemigrations` step (run by the implementer, never `migrate`):
`python manage.py makemigrations django_apps` after adding
`INSTALLED_APPS` + `models.py`.

## 11. Catalog results (Phase 3)

Generated and verified this session:

| File | Leaf keys | Notes |
|---|---|---|
| `frontend/src/finance/locales/{en,lv}.json` | 354 | incl. `server` namespace covering every `api.py` `message`/`detail` string + server-composed labels (`match_types`, `scopes`, `operators`, `periods`, `windows`, `period_text`) and job strings from both management commands |
| `frontend/src/tasks/locales/{en,lv}.json` | 165 | `nav`, `views`, `order`, `labels`, `menu`, `task`, `divider`, `form`, `detail`, `completed`, `list`, `archived`, `trash`, `search`, `toasts`, `undo`, `redo` |
| `frontend/src/shared/locales/{en,lv}.json` | 25 | `common`, `nav`, `burgerMenu`, `toasts`, `errors`; `common.months`/`am`/`pm` are JSON arrays (need `returnObjects` at integration) |

Verified independently: all six parse as JSON; en/lv key sets
identical per namespace (zero diff both directions); every
count-bearing key has `_zero`/`_one`/`_other` siblings (24 plural
groups; the `en` files carry `_zero` too — required for parity,
never selected by `Intl.PluralRules('en')`); Latvian files contain
real diacritics; ~10 translations spot-checked — correct LV plural
agreement (`0 transakciju` / `1 transakcija` / `2 transakcijas`),
2nd-person register, grammatical word-order inversions
(`par {{amount}} {{currency}} pārsniegts`).

Glossary highlights (full list in the subagent report): transaction
→ transakcija, spending limit → tēriņu limits, sync →
sinhronizēt/sinhronizācija, category → kategorija, rule →
noteikums, account → konts, balance → atlikums, counterparty →
darījuma partneris, label → birka, star → zvaigzne, divider →
atdalītājs, trash/archive → miskaste/arhīvs, share-verb →
koplietot vs share-noun → daļa.

Ambiguities resolved with context keys (worth knowing when wiring
`t()` calls): `Save` generic vs `rules.drawer.save`; `Apply` filter
submit vs rule re-apply (`Pielietot noteikumus vēlreiz`); `Share`
noun vs verb; `Complete`/`Completed`/`Uncomplete` as verb/adjective;
`Cancel`/`Close`/`Dismiss` kept as three distinct keys; `Add`
("Pievienot") vs `Create` ("Izveidot"). Two finance strings
(`accounts.noDevices`, `balances.emptyBody`) embed `<link>` —
integrate via `<Trans>` components, not raw `t()`.

## 12. Resolved decisions (were open questions)

- **Legacy templates**: not translated — SPA + jobs only (§6).
- **`twister.html`**: stays Latvian-only, no `{% trans %}` rework.
- **Language cookie**: keep the default `django_language` name.
- **Django-side date localization**: not wanted — client-side
  `Intl.NumberFormat`/`Intl.DateTimeFormat` covers money/dates.
