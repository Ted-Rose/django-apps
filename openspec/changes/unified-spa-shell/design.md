# Design

## Context

See proposal.md — Why. Current state that shapes the approach:

- `spa_shell` (`django_apps/views.py`) is `@login_required` +
  `@ensure_csrf_cookie` and embeds per-user `user`/`language`/
  `sentry` in `#spa-bootstrap`. Every app mount binds a distinct
  `entry` (`tasks`, `finance`, …) → per-app Vite inputs.
- Each `frontend/src/<app>/main.tsx` runs `createRoot` with its
  own `BrowserRouter basename="/<app>"`, `QueryClientProvider`,
  `initI18n('<app>', {en, lv})`, `initSentry()`. In-app links are
  absolute (`to="/accounts"`, `navigate("/")`) — ~32 sites — and
  are correct only because `basename` scopes them.
- `GET /api/me/` already exists (`django_apps/me.py`) returning
  `{username, language}` behind `django_auth` — the bootstrap
  endpoint grows `is_staff` + the csrf cookie.
- Vite already splits shared code into `shared/[name].[hash].js`;
  per-app entries are small (16–152K) on top of ~1M shared.
- `vercel.json` sends all non-`/static` traffic to `wsgi.py`;
  Vercel edge-caches function responses on `s-maxage` and purges
  on deploy. Static chunks already get `immutable` headers.
- The service worker treats navigations network-first — it will
  keep working; the edge-cached shell is just a faster network.

## Goals / Non-Goals

**Goals:**

- One HTML document for the whole app session; app-to-app nav is
  client-side; shared query cache survives it.
- Shell HTML identical for all users → edge-cacheable; the only
  startup round-trips are `/api/me` + the route's chunk.
- Zero changes to in-app links, routes, or API calls.
- Finance (primary use case) usable as early as possible.

**Non-Goals:**

- No change to `/api/` endpoints other than `/api/me/`; no change
  to `spa_url_for`/`SPA_BASES`, `app_redirect`, admin, OAuth, or
  the service worker's fetch strategy.
- No per-route code-splitting inside apps (each app stays one
  chunk); no SSR; no API response caching.
- `single_pages` keeps its root mounts (`/twister`, `/spoki/`).

## Decisions

### D1 — Nested `BrowserRouter` per app instead of rewriting links

The shell mounts one router with routes like
`<Route path="/finance/*" element={<FinanceApp/>}>`. Each app
exports a component that still renders its own
`<BrowserRouter basename="/finance">` — i.e. today's `main.tsx`
minus `createRoot`. Nested routers share the same history; the
inner one resolves all `to="/x"` links against `basename`, so
all ~32 absolute link sites keep working verbatim. When the URL
leaves `/finance/*` the outer router unmounts the whole subtree
(inner router included) — no stale matching.

*Alternative:* make apps' `<Routes>` relative-mountable
(descendant Routes under a splat) — requires rewriting every
absolute `to=`/`navigate()` and is easy to regress. Rejected.

### D2 — Bootstrap via `GET /api/me/`, Sentry stays inline

`MeOut` grows `is_staff`; the view gains
`@ensure_csrf_cookie` (moved off the shell). The shell fires the
fetch at module evaluation — parallel with the route's chunk
import, not after mount — and renders a spinner until it
resolves. `#spa-bootstrap` keeps `sentry` only: `initSentry()`
must run before app module imports to catch init-time failures,
and the config is identical for all users, so it doesn't break
edge-cacheability. `readBootstrap()` shrinks to the sentry
shape; a `useSession`/`SessionContext` exposes `/api/me` data.

*Alternative:* fetch Sentry config via the API too — delays
error reporting past the riskiest window. Rejected.

### D3 — `s-maxage` on the Django response, not a static file

`spa_shell` keeps rendering through Django (needed for the
`manifest_ready` diagnostic, the language `<html lang>` default,
and `VITE_DEV` dev mode) but emits
`Cache-Control: public, max-age=0, s-maxage=86400` and sets no
cookies. That is enough for Vercel edge caching; a fully static
file would lose the dev-mode/diagnostic branches and add a
build-step for near-zero gain.

*Alternative:* static `shell.html` under `/static/` + Vercel
rewrites — more moving parts, loses `manifest_ready` handling.
Rejected.

### D4 — i18n becomes additive

`initI18n` runs once in the shell with the `shared` catalogs;
each app's lazy module calls `i18next.addResourceBundle(lng,
ns, catalog)` for its own `en`/`lv` imports (side-effect at
chunk evaluation, before its components render). Language from
`/api/me` is applied via `changeLanguage` once the bootstrap
lands; catalogs are static imports so both languages are already
in the chunk — no fetch.

### D5 — Priority order: finance → idle-prefetch rest

Shell startup: `import('../finance/entry')` kicks off
immediately (Promise cached, React.lazy consumes it). After
first render, `requestIdleCallback` (fallback `setTimeout`)
imports tasks → notes → gmail → single_pages. Chunk URLs are
content-hashed + immutable-cached, so prefetch cost is tiny and
repeat visits hit browser cache.

### D6 — Home page becomes a shell route

`/ ` now hits `react_app` (public), and a `Home` component
re-implements the `home.html` card grid with client-side
`<Link>`s; the Admin card gates on `is_staff`. `home.html` is
deleted; the burger menu / `NavBar` stay as-is. Anonymous users
still see the dashboard (it is public today); clicking an app
triggers the bootstrap-401 → login redirect client-side.

### D7 — One `QueryClientProvider` in the shell

`shared/queryClient.ts` already exports a singleton client —
the provider moves to the shell root and per-app providers are
removed. Tasks and Notes read the same `GoogleTask` rows, so
this also fixes today's cross-app refetch duplication.

## Risks / Trade-offs

- Page GETs lose server-side auth → an anonymous user briefly
  sees the shell + spinner before the login redirect. → The
  shell contains zero user data; APIs still 401. Call out in PR.
- Edge-cached shell could go stale mid-session (deploys) →
  Vercel purges on deploy; `s-maxage` bounded at 1 day; chunks
  are content-hashed so HTML/JS never mismatch a build.
- CSRF: if `/api/me` ever stops setting the cookie, mutations
  fail. → Spec'd + a regression test asserting `csrftoken` in
  the response.
- Nested routers: an in-app `<a href>` (not `<Link>`) still
  full-reloads — same as today, no regression.
- i18n namespace collisions between apps → keep per-app
  namespaces (`initI18n('<app>', …)` convention unchanged).
- Larger initial bundle for `/`: shell + shared + home route is
  small; the win (no per-navigation HTML/vendor reload)
  dominates.
- `document.title` no longer set per mount server-side → shell
  sets it per route client-side.

## Migration Plan

1. Ship behind one PR: backend view/template changes +
   `frontend_dist` rebuild + regenerated `openapi.json`/
   api-types + spec sync all land together.
2. Deploy order is safe in either direction: new shell is
   additive; old per-app chunks become unreferenced but remain
   servable until the next build.
3. Rollback = revert the PR and redeploy — no data migration.
4. Bump `PWA_CACHE_VERSION` so service workers drop cached
   per-entry navigation responses.
5. Post-deploy check: `curl -I <site>/tasks/` shows
   `s-maxage` + no `Set-Cookie`; DevTools shows app→app nav
   without document requests.
