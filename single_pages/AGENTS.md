# single_pages — Agent Guide

One-off pages that don't merit their own Django app. Post-React-
rewrite the app is backend-only: no models, no admin, no templates,
no views — `views.py` was deleted at cutover and the spoki fetch
lives in `services.py`.

## Layout

- `services.py` — `fetch_spoki_article()`: `random.choice` over the
  hardcoded `SPOKI_URLS`, `requests.get` (fake browser UA, 10s
  timeout), BeautifulSoup parse → `{title, html, source_url}` with
  UNSANITIZED html (the API op runs `nh3.clean`).
- `api.py` — ninja `Router` mounted at `/api/single_pages/`:
  - `GET tts/?text=&lang=&filename=` — session-authenticated wrapper
    over `google_api.utils.text_to_audio` (the typed replacement for
    the legacy public `/text-to-audio`; same shape as
    `/api/gmail/audio/`). `ValueError` → 400, `AudioGenerationError`
    and other pipeline failures → 502 `upstream_error`.
  - `GET spoki/` — the article fetch + `nh3.clean` on the HTML.
    `RequestException` → 502. Sanitization is the F4 fix — the SPA
    renders `html` via `dangerouslySetInnerHTML`, so upstream
    `<script>`/`on*` must never reach it unsanitized.
- `urls.py` — root-mounted cutover shape: `twister` + `spoki/` serve
  the SPA shell (`react_app`, entry `single_pages`), `/app/*`
  301-redirects to `/*` via `app_redirect(base='')`. **Never add a
  `<path:subpath>` catch-all at this level** — the app is included
  at root and would shadow every later URLconf (and home). Deep
  links like `/twister/foo` intentionally 404.

## Frontend

`frontend/src/single_pages/` — Vite entry `single_pages`, plain
`BrowserRouter` (no basename — Django decides which URLs serve the
shell). Routes: `/twister`, `/spoki`, `*` → `/twister`. Latvian-only
UI — deliberately no i18n catalogs (the `i18next/no-literal-string`
rule is disabled per-file); `api.ts` carries a local `errorText`
instead of the i18n-dependent shared `errorDetail`.

- `routes/Twister.tsx` — 4 `FieldList` string lists (players / body
  parts / animals / colors), interval + pause (uncontrolled inputs
  read via refs at schedule time — mid-game edits apply to the next
  move), game loop: players cycle in order (starting at index 1 —
  template parity, the dead `moveLog` counted player 0 as move 0),
  each move picks a random item per sub-list and speaks them in
  order. Pauze stops scheduling after the current move; Spēlēt!
  restarts cleanly (the template spawned parallel loops).
- `components/useTwisterAudio.ts` — prefetch-on-start (deduped by
  `hashOf(text)` in a `Map`, hash doubles as the GCS `filename`),
  sequential `Audio` playback, `stop()` interrupts cleanly. Missing
  cache entries are skipped — same as a failed `<audio>` fetch in
  the template.
- `utils.ts` — `hashOf`, byte-identical to the template's djb2-ish
  hash (it's the GCS object name — same text must hash the same).

## Gotchas

- Auth tightened at cutover: both pages were public, `react_app` is
  `@login_required` and `django_auth` covers `/api/single_pages/*` —
  anonymous clicks on the home-page Twister card bounce to
  `/login/`. Deliberate (F3 hardening for the TTS endpoint).
- `spa_url_for` collapses `/api/single_pages/*` to `/twister` via
  `SPA_BASES` in `django_apps/api.py` — `next` after auth lands on
  the page, not a JSON URL.
- `hashOf` is also the GCS filename — keep it byte-identical so
  repeat phrases reuse the same server-side audio object.
- `text_to_audio` synthesizes + uploads on every cache miss — the
  prefetch is one call per field value per game start.
