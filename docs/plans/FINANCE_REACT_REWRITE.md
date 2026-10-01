# Finance React Rewrite — second app on the shared platform

> **Status**: ✅ Done — all six stages merged; the SPA serves
> `/finance/` (templates/static deleted) and `/finance/app/*` 301s.
> The platform built for google_tasks
> (`frontend/` workspace, `django_apps/api.py` NinjaAPI,
> `spa_shell`, django-vite, generated types, TanStack Query,
> `shared/` client/NavBar/Modal/Dropdown) is already live and
> deploy-verified on Cloud Run + Vercel — see
> `GOOGLE_TASKS_REACT_REWRITE.md`. This rewrite adds a second Vite
> entry; **no Docker, Vercel, CI, or settings changes are needed**.

## Decision

Rewrite `finance` as a React SPA exactly the way `google_tasks` was:

- `finance/api.py` — a django-ninja `Router` mounted on the existing
  `NinjaAPI` as `/api/finance/` (`api.add_router('/finance/',
  finance_router)` in `django_apps/urls.py`). One OpenAPI spec,
  types regenerated into `frontend/src/finance/api-types.ts`.
- `frontend/src/finance/` — new Vite entry
  (`main.tsx`, `BrowserRouter basename='/finance'`), reusing
  `frontend/src/shared/` wholesale.
- Same strangler mount: SPA lives at **`/finance/app/`** while the
  template UI keeps serving `/finance/*`; the final stage swaps
  them and 301s `/finance/app/*` → `/finance/*`.

Django remains the backend: session auth, GoCardless client,
`services/` (rules engine, limits math, sync, push) — all unchanged.

### One structural difference from google_tasks

google_tasks mutations were already JSON views, so the ninja layer
delegates (`api.py` `_adapt` → `views.py` handlers). **Finance views
are form-POST + `messages` + redirect** — there is nothing to
delegate to. The finance API therefore implements mutations directly
in `finance/api.py`, reusing the same forms (`CategoryRuleForm`,
`TransactionLimitForm`, `ShareAccountForm` — Django forms accept a
plain dict, so `Form(payload.dict(), user=request.user)` keeps
validation identical), the same `services/` functions
(`apply_rules`, `preview_rule`, `sync_account_transactions`,
`limit_window_stats`, `monthly_history`), and the same
`for_user()`-scoped querysets. The two views that already return
JSON (`preview_rule_view`, `push_subscribe`, `push_unsubscribe`)
port nearly verbatim.

Feedback convention changes: `messages.success/error` → API
responses carry a `message` string the SPA renders as a toast
(google_tasks `toasts.ts`/`Toasts.tsx` moves to `shared/` in
Stage 1).

## Current frontend surface (what's being replaced)

### Templates (~1,370 lines under `finance/templates/finance/`)

| Template | Lines | Becomes |
|---|---|---|
| `transactions.html` | 329 | route `/transactions` — the biggest page: sortable column headers with filter dropdowns, search, pagination |
| `rules.html` | 394 | route `/rules` — categories card, prioritized rules table, offcanvas rule drawer + sandbox preview |
| `limits.html` | 269 | route `/limits` — limit form (create/edit), per-window progress bars + past-month history, overview month dropdown, push-alert card |
| `category_overview.html` | 133 | route `/categories` — per-category spending table, date range + presets, account filter |
| `balances.html` | 107 | route `/balances` — balance cards + "Get latest balance" |
| `accounts.html` | 86 | route `/accounts` (also `/`, the SPA index — `/finance/` currently 404s) — account list, balance-check toggle, share form |
| `connect_bank.html` | 61 | route `/connect` — country input → institution dropdown → connect |
| `components/nav.html` | 21 | `<FinanceNavBar>` + `<Toasts>` (the `messages` block lives here today) |

### JS (~410 lines under `finance/static/finance/`)

| File | Lines | React equivalent |
|---|---|---|
| `push_subscribe.js` | 208 | `usePushSubscription` hook — `pushManager.subscribe`, VAPID key compare, re-register; POSTs move to `/api/finance/push/*` |
| `rule_sandbox.js` | 205 | debounced `useMutation`/`apiPost` to `/api/finance/rules/preview/` inside the rule drawer |
| `finance.css` | 17 | imported into the `finance` entry as-is |
| inline scripts | ~90 | sync/refresh spinner buttons → `isPending` states; creditor-menu filter → React state; `local-datetime` → `toLocaleString()` in render |

### Backend surface

- **Read views → GET endpoints** (7): `account_list` (GET part),
  `transaction_list`, `category_overview`, `live_balances`,
  `limits_view` (GET part), `rules_view`, `connect_bank` (GET part →
  institutions endpoint). Template context machinery
  (`page_url`/`sort_links`/dropdown options) flattens into response
  schemas — the SPA rebuilds URLs from `useSearchParams` instead of
  consuming pre-rendered hrefs.
- **Mutations → POST operations** (14): toggle balance-check,
  share, sync, refresh balances, limit save/delete, rule
  save/delete/move/apply/preview, category save/delete, push
  subscribe/unsubscribe.
- **Special flows**:
  - **Bank consent redirect** — `connect_bank` POST returns a
    GoCardless `link` the browser must navigate to (like Google
    OAuth: `fetch` never follows it). API returns
    `{link, requisition_id}`; the client does
    `window.location.assign(link)`. `requisition_id` still goes in
    the session exactly as today.
  - **`requisition_callback` (`/finance/callback/`) stays a Django
    view forever** — it's the external redirect target configured in
    the requisition (`{BASE_URL}/finance/callback/`); keeping the
    URL stable means no GoCardless-side change. It reads the
    session, creates accounts, then redirects to
    `/finance/accounts` (SPA post-cutover). Must be routed **before**
    the `<path:subpath>` catch-all.
  - **GoCardlessError** — views catch it into `messages.error`; API
    ops map it to `502 {error: 'upstream_error', detail}` so the SPA
    shows a toast instead of a page-level message.
  - **Web Push** — `push_config` (VAPID key, subscription count)
    moves into the limits GET response; subscribe/unsubscribe are
    already JSON and port as-is. `sw.js`'s `push` handler is
    untouched — notification clicks still open `/finance/limits/`,
    which serves the SPA post-cutover.

## API contract (`finance/api.py`, mounted at `/api/finance/`)

```
GET  /api/finance/accounts/            → AccountsOut
GET  /api/finance/institutions/?country=lv  → InstitutionsOut
GET  /api/finance/transactions/        → TransactionsOut
     ?account=&category=&creditor=&q=&sort=&direction=&page=
GET  /api/finance/categories/overview/ → CategoryOverviewOut
     ?from=&to=&account=
GET  /api/finance/limits/?month=YYYY-MM → LimitsOut
GET  /api/finance/balances/            → BalancesOut
GET  /api/finance/rules/               → RulesOut

POST /api/finance/connect/             {institution_id} → {link}
POST /api/finance/accounts/{id}/toggle-balance-check/
POST /api/finance/accounts/{id}/share/ {username}
POST /api/finance/transactions/sync/   {account?}
POST /api/finance/balances/refresh/
POST /api/finance/limits/save/         {limit_id?, account, category?,
                                        limit_7_days?, limit_30_days?,
                                        limit_monthly?, is_active}
POST /api/finance/limits/{id}/delete/
POST /api/finance/rules/save/          {rule_id?, ...CategoryRuleForm
                                        fields}
POST /api/finance/rules/{id}/delete/
POST /api/finance/rules/{id}/move/     {direction: 'up'|'down'}
POST /api/finance/rules/apply/
POST /api/finance/rules/preview/       {rule_id?, ...rule fields}
                                        → preview dict unchanged
POST /api/finance/categories/save/     {name, color}
POST /api/finance/categories/{id}/delete/
POST /api/finance/push/subscribe/      {endpoint, keys:{p256dh,auth}}
POST /api/finance/push/unsubscribe/    {endpoint}
```

Mutation successes return `{'success': true, 'message': '…'}`
(plus result data like `changed`/`created`/`updated`/`failed` counts)
so the SPA can toast the same sentence the template version showed
via `django.contrib.messages`.

### Schemas (Pydantic, source of the generated TS types)

```
AccountOut:     id, account_id, name, iban, institution_id, currency,
                is_owner, owner_username, included_in_balance_check,
                last_balance: dict|null, balance_updated_at
TransactionOut: id, transaction_id, booking_date, account: {id, name,
                iban}, remittance_information, counterparty
                (creditor_name or debtor_name — resolved server-side),
                effective_category: {id, name, color}|null,
                amount, currency
TransactionsOut: transactions, page, num_pages, count,
                accounts, categories, counterparties (filter dropdown
                option lists — same queries as the view), sort,
                direction, filters_active
CategoryRowOut: category_name, category_color, spent, received, net,
                share, currency, tx_count
LimitOut:       id, account, category|null, is_active,
                limit_7_days, limit_30_days, limit_monthly,
                window_stats: [{label, spent, threshold, pct, bar_pct,
                bar_class, remaining, over, history: [...]}]
RuleOut:        id, category_id, priority, counterparty_scope,
                counterparty_pattern, counterparty_match_type,
                description_pattern, description_match_type,
                description_exclusion, operator, is_active
CategoryOut:    id, name, color
RulesOut:       rules, categories, match_types, counterparty_scopes,
                operators            (choice lists → form dropdowns)
LimitsOut:      limits, overview_months, selected_month, as_of,
                push_config: {vapid_public_key, subscription_count}
```

Money fields are `Decimal` — DjangoJSONEncoder renders them as JSON
strings; treat them as `string` in TS and format with the row's
`currency` (no client-side float math on money).

Type generation — same workflow as tasks:

```bash
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json
npm run gen:types --prefix frontend
```

`gen:types` becomes two commands (or a loop) emitting
`src/tasks/api-types.ts` and `src/finance/api-types.ts` — per-entry
files per the original plan; both derive from the one committed
`openapi.json`. The `frontend.yml` drift check currently diffs only
`src/tasks/api-types.ts` — generalize it to `src/**/api-types.ts`
in Stage 0 (also recorded in `NEW_APP_REACT_GUIDELINES.md`).

## URL & cutover design (`finance/urls.py`)

During staging:

```python
path('app', views.app_redirect... , )          # n/a until cutover
path('app/<path:subpath>', views.react_app),   # SPA strangler mount
# ... existing template routes unchanged ...
```

At cutover the SPA takes over `/finance/` — but unlike tasks,
finance has **external `reverse()` callers** that must keep
resolving: `home.html` uses `{% url 'finance:accounts' %}` and
`evaluate_spending_limits` builds push-notification URLs from
`reverse('finance:limits')`. Keep every page name alive by naming
the shell routes:

```python
urlpatterns = [
    path('callback/', views.requisition_callback, name='callback'),
    # each GET page name → SPA shell (React Router resolves the page)
    path('', views.react_app, name='index'),          # new: /finance/
    path('connect/', views.react_app, name='connect'),
    path('accounts/', views.react_app, name='accounts'),
    path('transactions/', views.react_app, name='transactions'),
    path('balances/', views.react_app, name='balances'),
    path('limits/', views.react_app, name='limits'),
    path('rules/', views.react_app, name='rules'),
    path('categories/', views.react_app, name='categories'),
    # legacy strangler mount → 301
    path('app', views.app_redirect),
    path('app/<path:subpath>', views.app_redirect),
    path('<path:subpath>', views.react_app, name='spa_subpath'),
]
```

`react_app` is a finance-local twin of `google_tasks.views.react_app`
(GET/HEAD → `spa_shell(request, 'finance', title='Finance')`, else
404) — or promote it to `django_apps.views` since it's now shared by
two apps; do the same for `app_redirect` (it already hardcodes
`/tasks/`, so generalize the prefix). Non-GET/HEAD requests under
`/finance/` 404 post-cutover — the retired form-POST URLs
(`rules/save/`, `transactions/sync/`, `push/subscribe/`, …) must not
answer with the HTML shell.

## Frontend layout

```
frontend/src/finance/
  main.tsx            # createRoot + BrowserRouter basename='/finance'
  App.tsx             # Routes: / → Navigate to /accounts;
                      #   /accounts /connect /transactions /balances
                      #   /limits /rules /categories; * → /accounts
  api-types.ts        # generated — do not edit
  api.ts              # typed fetchers over shared/api/client.ts
  mutations.ts        # TanStack mutation hooks → toasts
  routes/
    Accounts.tsx      ConnectBank.tsx   Transactions.tsx
    Balances.tsx      Limits.tsx        Rules.tsx
    CategoryOverview.tsx
  components/
    FinanceNavBar.tsx           # finance burger items (mirror
                                # views._burger_menu_items)
    TransactionTable.tsx        # sort/filter dropdown headers
    Pagination.tsx
    RuleDrawer.tsx              # offcanvas form + debounced preview
    LimitForm.tsx  LimitRow.tsx # progress bars + <details> history
    PushCard.tsx                # usePushSubscription
    CategoryBadge.tsx
```

Routes stay `<Route path="/transactions" …>`-style; React Router
v7's `useSearchParams` replaces every `page_url`/`?edit=`/`?month=`
GET form — filters remain shareable/bookmarkable URLs.

`spa_shell.html` needs no changes (Bootstrap CDN links are already
in it). Bootstrap JS bundle isn't loaded by the shell — the tasks
SPA already re-implements dropdown/modal behavior in React;
finance's offcanvas drawer is a fixed-position div with a CSS
transition, same approach.

## Stages

Every merged stage deploys to prod; `/finance/` keeps serving
templates until the last stage. One PR per stage.

| Stage | Scope |
|---|---|
| 0. finance API | `finance/api.py` router + schemas; `api.add_router('/finance/', …)`; port all 7 reads + 14 mutations reusing forms/services; Django tests: session-auth 401, CSRF on POST, `for_user` isolation (incl. shared-account read vs owner-only share), limit `update_or_create` conflict → 409, rule preview payload, push-subscribe field validation, GoCardlessError → 502; export `openapi.json` |
| 1. SPA mount | `frontend/src/finance/` skeleton (main/App/NavBar/routes as stubs); Vite `input.finance`; `gen:types` second output; `spa_shell` at `/finance/app/` + catch-all; move `toasts.ts`/`Toasts.tsx` (and any other tasks-only helpers finance needs) to `src/shared/`; bump `PWA_CACHE_VERSION` |
| 2. Accounts & connect | accounts list + balance-check toggle + share form; connect page (`?country=` → institutions endpoint → POST → `window.location` to bank link); callback round-trip verified against the Django view |
| 3. Transactions | table + per-column sort/filter dropdowns + creditor typeahead + search + pagination + sync button (`isPending` spinner); all state in search params |
| 4. Rules & categories | categories card CRUD; rules table with edit/move/delete; rule drawer + debounced sandbox preview (port `rule_sandbox.js`); apply-rules button showing `changed` count |
| 5. Limits & balances | limit form create/edit (`?edit=` param), window progress bars + past-month `<details>` history, overview month dropdown, `usePushSubscription` card (port `push_subscribe.js`), balance cards + refresh; Vitest/RTL tests for transactions filters + rule drawer + limit stats; Playwright `finance.smoke.spec.ts` (load /finance/app/, open transactions, preview a rule) |
| 6. Cutover | URL swap above; `/finance/app/*` → 301; delete `finance/templates/`, `finance/static/`, form-POST branches of views, `components/nav.html`; keep `requisition_callback` + forms.py (still used by api.py validation); **repoint `tests.py` to `/api/finance/` URLs + JSON bodies** (the suite posts to `finance:` URLs today — see below); update `finance/AGENTS.md`, root `AGENTS.md`, READMEs; bump `PWA_CACHE_VERSION` |

## Risks / gotchas

- **Callback must stay server-side.** `/finance/callback/` is the
  `redirect_url` baked into GoCardless requisitions; it reads
  `session['requisition_id']` and mutates the DB. Route it before
  the catch-all, and don't move it under `/api/` (it's a browser
  navigation ending in a redirect, not a fetch).
- **Session writes from ninja ops.** `POST /connect/` sets
  `request.session['requisition_id']` — same as the view today;
  ninja hands the real Django request, nothing special needed, but
  cover the session write in a test.
- **Shared accounts are read-only for sharers** in every respect
  except their own `UserAccountPreference` toggle and their own
  category rules. API ops must keep `owner=request.user` on share
  and `for_user()` on reads — tests already exist for the view
  layer; port them.
- **Transaction list query count.** The view runs 4+ queries per
  page (page, accounts, categories, distinct counterparties) — keep
  it as ONE endpoint returning everything (the Vercel
  `max_connections` lesson: granular calls are the risk, not the
  response size).
- **`preview_rule` expects a dict-like** (`data.get('is_active') in
  ('on', 'true', '1', True)`) — pass the pydantic `.dict()`; JSON
  `true` matches `True` in that tuple already.
- **Checkbox semantics.** HTML forms omit unchecked boxes
  (`is_active` defaulting to off in POST means "present = on").
  `TransactionLimitForm`/`CategoryRuleForm` handle this correctly
  when fed the JSON dict — but an explicit `false` in the dict also
  works; no special-casing.
- **Limit uniqueness** (`account, user, category`) surfaces as
  `IntegrityError` on edit → map to 409 `{error: 'conflict'}`, same
  message as today.
- **Money as strings.** Decimals serialize as JSON strings; the UI
  must not `+` them. Progress bar `pct`/`bar_pct` arrive
  precomputed from `limit_window_stats`.
- **Push endpoints move** from `/finance/push/*` to
  `/api/finance/push/*` — the SPA hook reads URLs from the limits
  response (`push_config`), so the port is a string change, not a
  contract change.
- **`sync` stays one POST** looping `status='LN'` accounts —
  Vercel lambda timeout unchanged from today.
- **`/finance/` root is new** — no route exists today (404).
  Mounting `path('', react_app)` and defaulting the SPA to
  `/accounts` is a small improvement; `home.html`'s
  `finance:accounts` link keeps working either way.
- **Tests are the big hidden cost.** `finance/tests.py` (~2,400
  lines) exercises views via `reverse('finance:…')` form posts.
  They keep passing during strangler; at cutover every POST test
  must be repointed to `/api/finance/…` with JSON bodies and
  `{success, message}` assertions instead of `assertRedirects` +
  `messages`. Budget a real chunk of Stage 6 (or pre-port tests to
  the API in Stage 0 alongside the view tests — preferred: then
  cutover is deletion, not rewriting).
- **Both UIs write the same DB between Stage 1 and 6.** Mutation
  semantics identical because both paths call the same
  forms/services — same guarantee the tasks strangler relied on.

## Verification checklist (per stage)

```bash
source venv/bin/activate
python manage.py check
python manage.py test finance
npm run typecheck --prefix frontend && npm run lint --prefix frontend
python manage.py export_openapi_schema --api django_apps.api.api \
  > frontend/openapi.json && npm run gen:types --prefix frontend
  # → git diff must be empty for committed artifacts
```

Manual UI checks per stage: compare `/finance/<page>` (template)
against `/finance/app/<page>` (SPA) on the same data — same rows,
same totals, same progress bars; exercise one mutation in each UI
and confirm the other reflects it after refresh.
