# tv_archive — Agent Guide

Latvian TV schedule archive: a scraper pulls tet.lv listings and
enriches them with IMDb ratings + LV→EN translations. The UI is a
**public, read-only** React SPA — the first public mount on the
shared platform (`react_app_public`, anonymous bootstrap, no CSRF
cookie; the API is GET-only so no CSRF is needed).

## Views & API (post-cutover)

- The SPA (`frontend/src/tv_archive/`, Vite entry `tv_archive`,
  `BrowserRouter basename="/tv-arhivs"`) is served by
  `react_app_public` on the literal `tv-arhivs*` patterns in
  `urls.py` (root-mounted, no `<app>/` prefix). `/tv-arhivs/app/*`
  301-redirects to `/tv-arhivs/*` (legacy strangler mount); the
  `tv-arhivs` URL name survives for `home.html`'s
  `{% url 'tv_archive:tv-arhivs' %}`. No templates, no `views.py`.
- `GET /api/tv-arhivs/contents/` (`api.py`, `auth=None` — the first
  public operation on the shared NinjaAPI; `None` means no auth,
  `NOT_SET` would inherit `django_auth`). One fat GET: a page of
  `Content` rows plus the distinct `channels`/`content_ratings`/
  `types` option lists for the filter dropdowns.
- Filter params mirror the old template's GET form; typed params
  (`rating_value`/`ratio` floats, ISO dates) turn junk into 422
  instead of the old 500s. Deliberate changes vs the template:
  - `ratio` filters `ratio__gte` (a minimum match score — exact
    float equality almost never hits);
  - results are paginated at 50/page (`get_page` clamps
    out-of-range) with a fixed `-start_date, -id` ordering —
    the template returned all rows in arbitrary DB order;
  - `type` is a new exact-match filter (Stage 2) backing the
    SPA's type `<select>`;
  - `start_date`/`end_date` both filter `start_date`
    (`__gte`/`__lte`) — the template's "date range on the air
    date" quirk, kept verbatim.

## Model

`Content` is **global** data — no user FK, no `for_user()` scoping,
unlike every other app on the platform. `url` (the IMDb URL) is
the scraper's `update_or_create` key, so the same film on another
channel/day collapses into one row — `channel`/`start_date` are
last-write-wins, which explains surprising counts when eyeballing
the feed.

## Scraper (`scraper.py` + `manage.py fetch_tv_programs`)

Not wired to any URL — run manually via
`python manage.py fetch_tv_programs`. Scrapes tet.lv
(BeautifulSoup over urllib3 with retries), looks up each program
on IMDb, and translates titles via `googletrans`
(`django_apps.utils.translate_lv_to_eng`) — unofficial and brittle,
may break upstream without code changes. A run sleeps 1–2s per
program across ~14 days × 3 channels plus per-program IMDb detail
fetches: minutes-to-hours, far past any request budget.

## Tests

`tests.py`: `ContentsApiTests` covers the API contract (anonymous
GET → 200 is the `auth=None` tripwire, 422s, pagination shape,
ordering, each filter, option lists); `SpaMountTests` covers the
public shell mount, the `/tv-arhivs/app*` 301s and
`reverse('tv_archive:tv-arhivs')`. E2E:
`frontend/tests/e2e/tv_archive.smoke.spec.ts` (public — no seeded
user needed).
