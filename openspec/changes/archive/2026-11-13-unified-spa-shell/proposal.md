# Proposal

## Why

Every Django app is a separate React SPA today: its own Vite
entry, its own `createRoot`, its own `BrowserRouter`, its own
react-query `QueryClient`. Navigating between apps is a full
document reload — HTML round-trip, bundle fetch, React remount —
and it destroys the query cache every time, so even revisiting an
app the user just had open re-fetches everything. The dashboard
(/) is yet another document. The site behaves like five apps
stapled together, not one.

## What Changes

- **Unified shell**: one `shell` Vite entry
  (`frontend/src/shell/main.tsx`) mounts a single top-level
  `BrowserRouter`. Each app renders under its URL prefix as a
  lazy-loaded chunk that keeps its own nested
  `BrowserRouter basename` — zero changes to in-app links.
- **Edge-cached public shell HTML**: `spa_shell`/`react_app`
  lose `@login_required` and `@ensure_csrf_cookie`, emit
  `Cache-Control: public, s-maxage`, and become byte-identical
  for all users so Vercel edge-caches them. No per-user bytes in
  the HTML — the `#spa-bootstrap` json_script shrinks to
  deployment-level, user-agnostic config (Sentry) only.
- **Async bootstrap**: `GET /api/me/` becomes the bootstrap
  endpoint — returns `username`, `language`, `is_staff`, and
  plants the `csrftoken` cookie. The client fires it at startup,
  in parallel with the priority chunk import. On 401 the client
  navigates to `login_url` (client-side replaces today's
  server-side login redirect for page GETs).
- **One shared `QueryClientProvider`** at the shell level —
  react-query cache survives cross-app navigation.
- **Home page moves into the shell** as a React route: the
  `home.html` card grid becomes a component; `/` serves the same
  shell (stays public, as today). The Admin card is gated on
  `is_staff` from `/api/me`.
- **Priority loading**: the finance chunk (primary use case) is
  imported at bootstrap; remaining apps are idle-prefetched.
- Per-app Vite inputs are removed; per-app `main.tsx` files
  become mountable components.
- **BREAKING (behavioral)**: page GETs no longer 302 anonymous
  users to login server-side — they receive the public shell and
  the client redirects after the `/api/me` 401. No user data
  rides in HTML, so nothing protected is exposed.

## Capabilities

### New Capabilities

- `unified-shell-routing`: one React root owning all app routes —
  client-side app-to-app navigation with no document reload,
  per-app lazy chunks, shared query client, priority ordering.

### Modified Capabilities

- `spa-shell`: shell rendering becomes public and edge-cacheable;
  per-user bootstrap moves from inline json_script to `/api/me`;
  mounts bind one `shell` entry instead of per-app entries; `/`
  joins the shell; the one-slug-everywhere convention loses its
  Vite-input leg.
- `api-contract`: `/api/me/` gains the bootstrap role — payload
  fields plus planting the `csrftoken` cookie formerly set by
  `@ensure_csrf_cookie` on the shell.

## Impact

- Backend: `django_apps/views.py` (`spa_shell`, `react_app`,
  `home`), `django_apps/urls.py` (mounts, `/` route),
  `django_apps/me.py` (`MeOut`, csrf cookie),
  `django_apps/templates/spa_shell.html`, `home.html` (retired).
- Frontend: new `frontend/src/shell/`; every
  `frontend/src/*/main.tsx` refactored to a component export;
  `frontend/vite.config.ts` inputs; `shared/i18n.ts` (additive
  catalog registration); `shared/api/client.ts` (bootstrap
  fetch); `shared/bootstrap.ts` (shrinks to sentry);
  `frontend/src/shared/queryClient.ts` (provider moves up).
- Contract surfaces: `frontend/openapi.json` +
  `src/*/api-types.ts` regenerate (`MeOut` grows).
- Tests: Django view tests asserting anonymous page GETs → 302
  must be updated to expect the public shell; new Vitest coverage
  for the shell router and bootstrap flow.
- Deploy: Vercel edge cache keyed on the shell responses;
  invalidated automatically per deploy. No `vercel.json` change
  (routes already pass everything to `wsgi.py` except `/static`).
- Docs: `AGENTS.md` (SPA shell section), `frontend/README.md`,
  `docs/changelog.md`.
