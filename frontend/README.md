# frontend/ — React workspace

Shared Vite + React + TypeScript workspace for the React apps.
**One Vite entry**: `src/shell/` is the unified SPA shell — a
single React root + `BrowserRouter` + shared `QueryClient` for
the whole site. Each app (`src/tasks/`, `src/finance/`,
`src/gmail/`, `src/notes/`, `src/single_pages/` — google_tasks
is `src/tasks/`) exports a default component from its
`main.tsx`, wrapped in `shared/components/AppRouter` for
basename semantics, and lazy-loads via the route table in
`src/shell/App.tsx`. Cross-app navigation is client-side — no
document reload, one shared query cache. Django stays the
backend: session auth, CSRF and the ninja API are all
same-origin. Per-user context (`username`/`language`/`is_staff`)
arrives from `GET /api/me/` at shell startup
(`src/shared/session.tsx`); the shell HTML itself is public and
edge-cacheable (Sentry-only bootstrap). The build lands in
repo-root `frontend_dist/` (gitignored), which
`STATICFILES_DIRS` + `django-vite` resolve through
`manifest.json`.

See `docs/plans/GOOGLE_TASKS_REACT_REWRITE.md` for the staged
plan (the shell unification landed after it).

## Commands

```bash
cd frontend
npm ci                  # install (package-lock.json is authoritative)
npm run dev             # Vite dev server, proxies to Django :8000
npm run build           # tsc --noEmit + vite build → ../frontend_dist
npm run lint            # ESLint
npm run typecheck       # tsc --noEmit
npm test                # Vitest + React Testing Library (jsdom)
npm run format:check    # Prettier --check (`npm run format` to fix)
npm run gen:types       # regen src/tasks/api-types.ts from openapi.json
```

## E2E smoke tests (opt-in — Playwright)

`tests/e2e/` holds a small Playwright smoke suite (`npm run test:e2e`,
config: `playwright.config.ts`). It is deliberately **not** part of
`npm test`, the lint/typecheck pipeline, or CI — each test drives a
**real running Django server** with a real database, session login
and CSRF-protected POSTs.

### Prerequisites

1. Install browsers once:

   ```bash
   cd frontend
   npx playwright install chromium
   ```

2. Build the SPA (the shell page only mounts the bundle when
   `frontend_dist/manifest.json` exists):

   ```bash
   npm run build --prefix frontend   # from the repo root
   ```

3. Seed a staff user with at least one task in the database the
   server is running against:

   ```bash
   source venv/bin/activate
   python manage.py shell -c "
   from django.contrib.auth.models import User
   from google_tasks.models import GoogleTask, GoogleTaskList
   u, _ = User.objects.get_or_create(
       username='e2e',
       defaults={'is_staff': True, 'is_superuser': True})
   u.set_password('e2e-pass'); u.save()
   lst, _ = GoogleTaskList.objects.get_or_create(
       user=u, list_id='e2e-list', defaults={'title': 'E2E'})
   GoogleTask.objects.get_or_create(
       user=u, task_id='e2e-seed',
       defaults={'title': 'E2E seed task', 'task_list': lst})
   "
   python manage.py runserver
   ```

   The suite logs in through `/admin/login/` — the app itself only
   offers Google OAuth at `/login/`, which a browser test cannot
   complete; the admin session cookie is the same session auth the
   ninja API checks. The seeded user therefore needs `is_staff`
   (admin rejects non-staff) and at least one visible task for the
   mutation round trip.

### Running

```bash
cd frontend
E2E_USERNAME=e2e E2E_PASSWORD=e2e-pass npm run test:e2e
# or point at another server:
E2E_BASE_URL=http://localhost:8000 E2E_USERNAME=... E2E_PASSWORD=... \
  npm run test:e2e
```

What it covers:

- `shell.smoke.spec.ts` — the unified shell: public edge-cacheable
  HTML (`s-maxage`, byte-identical for all users), anonymous
  dashboard at `/`, deep-link → shell → client-side bounce to
  login, and dashboard → finance → tasks navigation with no
  document reload.
- `<app>.smoke.spec.ts` per app — anonymous deep links serve the
  shell then bounce to login after the `/api/me/` 401; the API
  answers 401 without a session; admin login renders the app
  (navbar + seeded content); a mutation round trip (e.g. tasks
  star-toggle) leaves seeded data unchanged.
- `i18n.smoke.spec.ts` — `?lang=lv` renders Latvian chrome and the
  language switcher PATCHes `/api/me/` so the pref survives
  reloads.

Without `E2E_USERNAME`/`E2E_PASSWORD` the authenticated specs skip
themselves; the unauthenticated bounce always runs.
