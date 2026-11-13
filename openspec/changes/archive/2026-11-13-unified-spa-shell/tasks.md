# Tasks

## 1. Backend — public edge-cached shell + bootstrap endpoint

- [x] 1.1 backend: Strip `user`/`language` from the
  `#spa-bootstrap` context in `spa_shell` (keep `sentry`), so
  the rendered HTML is byte-identical for all users — verify a
  rendered page's json_script contains only `sentry`.
- [x] 1.2 backend: Remove `@login_required` and
  `@ensure_csrf_cookie` from `spa_shell`/`react_app` in
  `django_apps/views.py`; add `Cache-Control: public,
  max-age=0, s-maxage=86400` — verify with `curl -si` on an
  app URL: 200 + s-maxage + no `Set-Cookie` while logged out.
- [x] 1.3 backend: Extend `GET /api/me/` in `django_apps/me.py`
  — add `is_staff` to `MeOut`/payload and decorate with
  `@ensure_csrf_cookie` — verify a test asserts `csrftoken` in
  the response and the new field serializes.
- [x] 1.4 backend: Regenerate `frontend/openapi.json`
  (`manage.py export_openapi_schema`) and run
  `npm run gen:types --prefix frontend` — verify `MeOut` /
  `api-types.ts` diffs only grow `is_staff`.
- [x] 1.5 backend: Route `/` to `react_app` in
  `django_apps/urls.py` (drop `views.home`, delete
  `django_apps/templates/home.html`) — verify `GET /` returns
  the shell for anonymous and authenticated users.
- [x] 1.6 backend: Update `django_apps` view tests —
  anonymous page GETs now expect 200 shell (not 302 to login),
  non-GET/HEAD still 404, `/` serves the shell — verify
  `python manage.py test django_apps` passes.

## 2. Frontend — shell entry and app refactor

- [x] 2.1 frontend: Create `frontend/src/shell/main.tsx` +
  `App.tsx`: single `BrowserRouter`, one `QueryClientProvider`,
  `initSentry` + `initGlobalErrorHandlers` first, session
  bootstrap (`GET /api/me`) fired at module eval with a
  loading state, 401 → navigate to `login_url` with
  `next=<current path>` — verify Vitest covers the 401
  redirect and loading state.
- [x] 2.2 frontend: Add the shell route table — `/` → `Home`,
  `/tasks/*`, `/finance/*`, `/gmail/*`, `/notes/*` →
  `React.lazy` app components wrapped in `Suspense` (loading
  indicator), `/twister` + `/spoki/*` → `single_pages`, plus
  per-route `document.title` — verify each path renders its
  app in tests or dev server.
- [x] 2.3 frontend: Refactor each `frontend/src/<app>/main.tsx`
  (tasks, finance, gmail, notes, single_pages) into a default
  exported component keeping its own `BrowserRouter basename`
  — remove `createRoot` and `QueryClientProvider` per app —
  verify in-app absolute links still resolve under the nested
  router in the dev server.
- [x] 2.4 frontend: Make i18n additive — `initI18n` once in the
  shell (shared catalogs); each app module registers its
  `en`/`lv` bundles via `addResourceBundle` at chunk eval;
  apply bootstrap `language` via `changeLanguage` — verify
  switching apps keeps translations and `i18n:check` passes.
- [x] 2.5 frontend: Port `home.html` to a `Home` shell
  component (card grid, `<Link>`s, Admin card gated on
  `is_staff` from the bootstrap) — verify `/` renders it and
  staff/non-staff visibility in a Vitest.
- [x] 2.6 frontend: Update `shared/bootstrap.ts` /
  `shared/api/client.ts` — `readBootstrap` shrinks to the
  sentry shape; add the session bootstrap fetch +
  context/hook — verify typecheck and existing client tests
  pass.
- [x] 2.7 frontend: `vite.config.ts` — replace the five inputs
  with `shell: 'src/shell/main.tsx'`; keep the
  `shared/` chunk naming — verify `npm run build` emits
  `shell/` + lazy per-app chunks and `manifest.json` has the
  shell entry.
- [x] 2.8 frontend: Priority loading — kick off the finance
  chunk import at shell startup; idle-prefetch
  (requestIdleCallback/setTimeout fallback) tasks → notes →
  gmail → single_pages after first render — verify import
  order in code + a test or manual network-panel check.
- [x] 2.9 frontend: Update/add Vitest coverage for the shell
  router, bootstrap flow, Home; adjust existing tests that
  assumed per-app roots — verify `npm test`, `npm run lint`,
  `npm run format:check`, `npm run typecheck`,
  `npm run i18n:check` all pass.
- [x] 2.10 frontend: Bump `PWA_CACHE_VERSION` in
  `django_apps/views.py` so workers drop stale per-entry
  navigation caches — verify the constant increments.

## 3. Integration and docs

- [x] 3.1 both: Manual smoke in dev server — `/` dashboard →
  click into finance → back → into tasks: no document reload,
  cached lists instant; logged-out deep link → shell → login
  redirect — verify in browser Network tab (no navigation
  requests between apps).
- [x] 3.2 both: Update `AGENTS.md` (SPA-shell section + the
  slug/Vite-input convention), `frontend/README.md`, and
  `docs/changelog.md` — verify the docs describe the unified
  shell, `/api/me` bootstrap, and edge caching.
- [x] 3.3 both: Run `openspec validate --all --strict` — must
  pass clean before archive.

## Workflow follow-up

- Archive via `openspec archive unified-spa-shell` on the
  feature branch before opening the PR (per repo convention:
  specs + code + history land in the same PR).
