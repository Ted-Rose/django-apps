# Deprecate `tv_archive` and `bible_research`

Both apps are redundant and can be removed outright (no replacement
planned). Deleting them also resolves two open security findings
(`docs/plans/SECURITY_AUDIT_FIXES.md` F8 — unauthenticated ESV proxy
burning our `ESV_KEY` quota; F9 — unauthenticated, unvalidated
`/tv-arhivs` list endpoint) and lets us drop the fragile
`googletrans` dependency.

## Current state

| App | URLs | Models / DB | External deps |
|-----|------|-------------|---------------|
| `tv_archive` | `GET /tv-arhivs` (`content_list`) | `Content` → table `tv_archive_content` (real data in Aiven Postgres) | tet.lv scrape, IMDb scrape, `googletrans` via `django_apps.utils.translate_lv_to_eng` |
| `bible_research` | `GET|POST /bible/` (`generate_audio` form + audio JSON), `GET /bible/verses` | none | `api.esv.org` via `settings.ESV_KEY` |

Notes:

- `tv_archive/views.py::fetch_tv_program_details()` is not wired to a
  URL (manual shell use only) — it disappears with the app.
- `tv_archive/management/commands/` and `tv_archive/api.py` sources
  are already gone; only stale `__pycache__` files remain.
- `bible_research` has no migrations — nothing to undo in the DB.
- Both `tests.py` files are empty stubs — no test loss.
- `media/bible_research/` exists locally (recordings, speaker_logo)
  and is gitignored.

## Step 1 — code removal (one PR)

1. **Delete the app directories**: `tv_archive/`, `bible_research/`
   (includes templates, `esv_bible_chapters.json`, migrations).
2. **`django_apps/urls.py`**: remove the two `include()` lines
   (`tv_archive`, `bible_research`). `/tv-arhivs`, `/bible/`,
   `/bible/verses` will then 404 — acceptable for personal use; add
   redirects only if external links matter.
3. **`django_apps/settings.py`**:
   - remove `'tv_archive'` and `'bible_research'` from
     `INSTALLED_APPS`;
   - remove all three `ESV_KEY` assignments (cloud block,
     `private_settings.json` block, local fallback);
   - remove the `'tv_archive'` entry in `LOGGING['loggers']`.
4. **`django_apps/templates/home.html`**: delete the "TV Archive" and
   "Bible Audio" cards.
5. **`django_apps/utils.py`**: delete the file — it only contains
   `translate_lv_to_eng`, whose sole caller was `tv_archive`.
6. **`requirements.txt`**: remove `googletrans==4.0.0-rc1`. Keep
   `beautifulsoup4` (still used by `google_api` and `single_pages`);
   `urllib3`/`certifi` were transitive deps of `requests`, never
   pinned.
7. **`django_apps/views.py`**: bump `PWA_CACHE_VERSION` (`'12'` →
   `'13'`) so the service worker picks up the new home page.
8. **`.gitignore` / `.dockerignore`**: remove the
   `media/bible_research/*` lines; delete the local
   `media/bible_research/` directory.
9. **Build/CI dummy secrets** (optional tidy — harmless either way):
   drop `'ESV_KEY': ''` from the build-time `private_settings.json`
   in `Dockerfile` and `.github/workflows/frontend.yml`.
10. **`bootstrap_gcp.sh`**: remove the `ESV_KEY` prompt/`gcloud
    secrets create` block.

## Step 2 — drop `tv_archive_content`

The agent cannot run `migrate`; the deploy workflow applies
migrations on merge to `main`, so a migration file is all we need.
Options, in order of preference:

- **Recommended — single deploy**: generate an empty migration in
  `django_apps` (`python manage.py makemigrations django_apps
  --empty -n drop_tv_archive`) and fill it with:

  ```python
  migrations.RunSQL(
      'DROP TABLE IF EXISTS tv_archive_content',
      reverse_sql=migrations.RunSQL.noop,
  ),
  migrations.RunSQL(
      "DELETE FROM django_migrations WHERE app = 'tv_archive'",
      reverse_sql=migrations.RunSQL.noop,
  ),
  ```

  One PR, table gone on next deploy, no orphaned `django_migrations`
  rows.
- **Alternative**: leave the table (it becomes orphaned but
  harmless) and `DROP TABLE` manually via psql later.
- **Heavier**: two-phase `DeleteModel` — empty
  `tv_archive/models.py`, `makemigrations`, deploy, then remove the
  app in a second PR. Standard but unnecessary here since the data
  is disposable.

## Step 3 — secrets & infra

- **`terraform/cloud_run.tf`**: remove the `ESV_KEY` env block
  (`secrets`/`env` entry ~lines 51-54).
- **`terraform/secrets.tf`**: removing `"ESV_KEY"` from the list
  makes the next `terraform apply` (automatic on `main`)
  **destroy the GCP secret** — irreversible. Safer default: leave
  `secrets.tf` untouched in this PR, remove the secret deliberately
  in a follow-up once the deploy is verified.
- **Vercel**: delete the `ESV_KEY` env var in the Vercel project
  settings manually (no IaC for it).
- **`private_settings.json`** (local, gitignored): the `ESV_KEY`
  key can be deleted; leaving it is harmless since nothing reads it.
- **`docs/VERCEL_SETUP.md`**: remove the `ESV_KEY` row.
- **`docs/plans/MIGRATION.md`**: remove `ESV_KEY` from the secrets
  list.

## Step 4 — docs

- **`AGENTS.md`**: remove the `tv_archive`/`bible_research` repo-map
  rows; update the URL-routing paragraph; drop `ESV_KEY` from the
  env-var list; update the `django_apps` row (no more `utils.py`
  translation); fix the templates bullet (`google_api/tv_archive/
  single_pages` → `google_api/single_pages`); remove the `tv_archive`
  logging note and the `googletrans` gotcha.
- **`docs/changelog.md`**: add a removal entry.
- **`docs/plans/SECURITY_AUDIT_FIXES.md`**: optionally mark F8/F9
  resolved-by-removal.
- Historical plan docs (`*_REACT_REWRITE.md`,
  `NEW_APP_REACT_GUIDELINES.md`) reference these apps as examples —
  leave them; they are point-in-time records.

## Verification

```bash
source venv/bin/activate
python manage.py check
python manage.py makemigrations --check   # no pending model changes
python manage.py test                     # remaining apps unaffected
python manage.py runserver
# / renders home without the two cards
# /tv-arhivs, /bible/, /bible/verses → 404
```

After deploy: confirm `tv_archive_content` is gone
(`\dt tv_archive*`), confirm the site works on both Cloud Run and
Vercel, then optionally destroy the GCP `ESV_KEY` secret and remove
it from `secrets.tf`.

## Rollback

Everything is a plain revert of the removal PR, except the dropped
table (data disposable anyway) and a destroyed `ESV_KEY` secret —
which is why secret destruction is deferred to a verified follow-up.
