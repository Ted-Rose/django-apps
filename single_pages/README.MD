Simple single page apps that don't deserve an django app on their own :(

## Twister (`/twister`)

Latvian Twister announcer — edit the four lists (players, body
parts, animals, colors), set the interval, hit "Spēlēt!". Each move
picks the next player plus a random part/animal/color and speaks
them via TTS (`GET /api/single_pages/tts/`, gTTS → GCS signed URLs,
audio cached by `hashOf(text)`). Pauze stops scheduling after the
current move.

## Spoki (`/spoki/`)

Random spoki.lv article proxy — the fetch stays server-side
(`GET /api/single_pages/spoki/` → `services.fetch_spoki_article()`)
and the returned HTML is `nh3`-sanitized before the SPA renders it.

## Stack

React SPA (`frontend/src/single_pages/`, Vite entry `single_pages`,
root-mounted so no `basename`), django-ninja API at
`/api/single_pages/` (session auth — both pages are login-required).
The Django side has no models/templates/views. See `AGENTS.md` here
and `docs/plans/SINGLE_PAGES_REACT_REWRITE.md` for the design.
