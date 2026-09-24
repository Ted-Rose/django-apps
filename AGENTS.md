# Project Guidelines for AI Agents

## What this repo is

Personal Django 4.2 monolith ("collection of random Django apps") —
several small apps sharing one project, one Postgres database, and one
deployment. GitHub: `Ted-Rose/django-apps`. Primary production target is
GCP Cloud Run (project `gmail-vercel`, region `europe-west3`); Vercel
(`vercel.json`, `build_files.sh`) and PythonAnywhere
(`tedisrozenfelds_pythonanywhere_com_wsgi.py`) configs are legacy.

## Repository map

| Path | Purpose |
|------|---------|
| `django_apps/` | Project settings, root urls, home page, PWA endpoints (`sw.js`, `manifest.webmanifest`, `offline/`), `utils.py` (LV→EN translation via googletrans), `gcp.py` (Secret Manager helper), `console_tasks/build.py` (Vercel build-time file generators) |
| `google_api/` | Shared Google OAuth2 layer + Gmail reader + text-to-audio (gTTS → GCS signed URLs). See `google_api/AGENTS.md` and `google_api/README.md` |
| `google_tasks/` | Largest app. Google Tasks bidirectional sync with local-only features (stars, labels, dividers, archive/trash, manual ordering). See `google_tasks/AGENTS.md` and `google_tasks/README.md` |
| `finance/` | GoCardless Bank Account Data integration: bank linking, shared accounts, transaction sync, spending limits. See `finance/AGENTS.md` |
| `bible_research/` | ESV API wrapper (`api.esv.org`): verse lookup as JSON and passage audio. No models |
| `tv_archive/` | Latvian TV schedule scraper (tet.lv) enriched with IMDb ratings. `fetch_tv_program_details()` is **not** wired to a URL — run it manually via shell |
| `single_pages/` | One-off pages that don't merit their own app (twister, spoki.lv proxy) |
| `terraform/` | All GCP infra: Cloud Run service + jobs, paused Cloud Scheduler triggers, secrets refs, Artifact Registry, GCS audio bucket, WIF |
| `docs/` | `QUICKSTART.md` (GCP deploy runbook), `changelog.md`, `coding_diary.md` (dev log), `plans/` (design docs) |

URL routing (`django_apps/urls.py`): `google_api` and `single_pages`,
`tv_archive`, `bible_research` mount at root; `google_tasks` under
`/tasks/`; `finance` under `/finance/`; `admin/` is Django admin (also
used for logout via `/admin/logout/`).

## Environment & settings

- `django_apps/settings.py` has **two modes**:
  - GCP (`GAE_APPLICATION`, `K_SERVICE`, or `USE_GCP_SECRETS=true` set):
    secrets come from env vars injected by Cloud Run
    (`DJANGO_SECRET_KEY`, `DATABASE_URL`, `APP_BASE_URL`, `ESV_KEY`,
    `GOOGLE_OAUTH_CLIENT_JSON`, `GOCARDLESS_SECRET_ID`,
    `GOCARDLESS_SECRET_KEY`, `GCS_AUDIO_BUCKET`).
    `GOOGLE_OAUTH_CLIENT_JSON` is written to `/tmp/app_secrets.json`
    at settings import.
  - Local: reads `private_settings.json` at repo root (gitignored;
    template: `private_settings_template.json`). **Without it, every
    `manage.py` command — including tests — raises
    `FileNotFoundError`.**
- Google OAuth client secrets live in `google_api/app_secrets.json`
  locally (gitignored); DB CA cert in `ca.pem` (gitignored).
- Virtualenv is at `venv/` (VS Code already points at it).

### Commands

```bash
source venv/bin/activate
python manage.py check            # sanity check settings/imports
python manage.py runserver        # dev server (sslserver also installed:
                                  # runsslserver for HTTPS, needed for OAuth)
python manage.py test <app>       # e.g. python manage.py test finance google_tasks
python manage.py sync_bank_transactions --dry-run
python manage.py evaluate_spending_limits
```

No linter/formatter is configured. Follow the existing style: PEP 8,
**max line length 79 chars**, compact function-based views, double
quotes vs single quotes are mixed — match the surrounding file.

## Hard rules

### Database migrations
Never run database migrations (`python manage.py migrate`,
`makemigrations`, or any equivalent command). Migrations are managed
outside of agent sessions. (Note: CI deploy runs `migrate` via a Cloud
Run job — that's fine, it happens in the workflow, not here.)

### Documentation and planning
When the user requests writing a plan to a markdown file, always save it
in the `docs/plans/` directory.

Example:
- ✅ `docs/plans/FEATURE_IMPLEMENTATION_PLAN.md`
- ❌ `FEATURE_IMPLEMENTATION_PLAN.md` (root directory)
- ❌ `docs/FEATURE_IMPLEMENTATION_PLAN.md` (docs directory)

### Secrets — never commit or print
Gitignored and must stay that way: `private_settings.json`,
`google_api/app_secrets.json`, `ca.pem`, `terraform/terraform.tfstate*`,
`terraform/tfplan`, `terraform/.terraform/`, `settings.json`, `data/`.
Never log tokens/credentials; Terraform state lives in GCS backend
(`gmail-vercel-tf-state`).

## Conventions

- **Views**: function-based only. `@login_required` on everything
  user-facing; POST endpoints also get `@require_POST`. JSON endpoints
  return `JsonResponse({'success': ...})` or `{'error': ...}` with an
  HTTP status.
- **Auth pattern for Google APIs**: services return either a result or a
  dict `{'authorization_url', 'state', 'scopes'}` — callers must detect
  the dict and redirect into the OAuth flow (see
  `google_tasks/views.py` dashboard for the canonical pattern).
- **Per-user isolation**: every query filters by `user=request.user`;
  finance uses `for_user()` queryset helpers that include shared
  accounts. Always scope `get_object_or_404` by user.
- **Navigation**: views build a `burger_menu_items` list of dicts
  (`label`, `url`, `icon`, `btn_class`) rendered by
  `django_apps/templates/components/burger_menu.html`. Copy this pattern
  for new pages.
- **Templates/static**: Bootstrap 5 + Bootstrap Icons via CDN; app
  templates under `<app>/templates/` (google_tasks/finance namespace
  into subdirs; google_api/tv_archive/single_pages are flat). Dashboard
  JS config is passed via `json_script` (`get_dashboard_js_config`);
  dashboard JS lives in `google_tasks/static/google_tasks/js/dashboard/`.
- **Sync pattern**: external objects are mirrored locally via
  `update_or_create` keyed on the remote ID (`task_id`, `list_id`,
  `transaction_id`, `account_id`, `requisition_id` are unique-ish keys).
- **Logging**: `logging.getLogger('django')` in most apps (`tv_archive`
  uses `__name__` with its own logger config in settings).
- **Tests**: Django `TestCase` in each app's `tests.py`; factory helper
  functions (`make_*`) instead of fixtures; mock external APIs with
  `unittest.mock.patch`.

## Deployment & CI

- Push to `main` → `.github/workflows/deploy.yml`: docker build →
  Artifact Registry → one-off Cloud Run job runs `manage.py migrate` →
  `gcloud run deploy django-apps` → updates job images.
- `terraform.yml` plans on PRs touching `terraform/`, applies on main.
- Both workflows share `concurrency: gcp-main` — intentional, they
  mutate the same Cloud Run resources.
- Auth to GCP uses Workload Identity Federation (no service-account
  keys).
- Cloud Run service: `django-apps`, scales 0→1, unauthenticated access
  allowed (app does its own auth), image tag `latest` is what Cloud Run
  actually runs.
- Scheduled jobs (`sync-bank-transactions`, `evaluate-spending-limits`)
  are defined in `terraform/cloud_run_jobs.tf` with Cloud Scheduler
  triggers — **schedulers are `paused = true`**, so jobs currently only
  run on manual/CI invocation.
- `bootstrap_gcp.sh` = one-time GCP setup; `migrate_to_django_apps.sh` =
  move infra to a new GCP project.
- Dockerfile builds `collectstatic` against a dummy
  `private_settings.json` created at build time — keep that block
  strict, a silent failure ships a site with no CSS/JS.

## Gotchas

- `settings.py` prints `MEDIA_ROOT:` on every import — expected noise,
  not an error.
- Google credential datetimes: Google auth lib expects **naive UTC**,
  Django stores **aware** — `google_api/utils.py` converts both
  directions. Reuse `get_user_credentials()` / `get_creds_dict()`;
  don't build `Credentials` objects manually.
- Google Tasks API limitations: no reminders, `due` is date-only, no
  move-between-lists op (code does get+insert+delete), limited batching.
- `googletrans==4.0.0-rc1` is an unofficial free API — `tv_archive` and
  `django_apps.utils.translate_lv_to_eng` may break without code
  changes being at fault.
- `OAUTHLIB_INSECURE_TRANSPORT=1` and `OAUTHLIB_RELAX_TOKEN_SCOPE=1`
  are set at `google_api.utils` import time (needed for local dev and
  incremental scopes).
- `text_to_audio` requires `GCS_AUDIO_BUCKET` + GCP credentials — it
  cannot work in pure local dev.
- google_tasks trash is advertised as "auto-purged after 30 days" in UI
  text and model help_text, but **no purge job exists** — items stay
  until `permanent_delete_task_view` runs.
- `Content.__str__` in tv_archive references `self.title` which doesn't
  exist on the model (latent bug — admin display will error).

## Where to look first

- App behavior details: `google_api/README.md`, `google_tasks/README.md`
  (very thorough), `single_pages/README.MD`
- Infra/deploy: `docs/QUICKSTART.md`, `terraform/`
- Past design docs: `docs/plans/`, `.research/`
