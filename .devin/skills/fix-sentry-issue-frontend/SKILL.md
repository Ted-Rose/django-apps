---
name: fix-sentry-issue-frontend
description: Pull unresolved production errors from the Sentry
  django-apps-web project, reproduce and fix them on a branch cut
  from main, open a PR, and mark the Sentry issue resolved
  only after the PR merges. Invoke when the user asks to fix
  Sentry issues / triage the Sentry queue in django-apps.
---

# Fix an unresolved Sentry issue (django-apps-web)

Target repo: this one — `Ted-Rose/django-apps` (remote `origin`,
the owner's own repo, not a fork; default branch `main`). The
Sentry project is `django-apps-web` in org `django-apps-ted`,
hosted in the **EU region — `https://de.sentry.io`**, NOT
sentry.io.

## 0. Auth — required before anything else

    source ~/.config/devin/sentry.env   # provides SENTRY_API_TOKEN

The token is a user-level auth token shared across the user's
Sentry orgs. If `SENTRY_API_TOKEN` is unset, STOP and tell the
user to set it up once:

1. de.sentry.io → User Settings → Auth Tokens → Create New Token
   (or an org internal integration scoped to `django-apps-ted`).
2. Permissions: `Issue & Event: Read & Write`, `Project: Read`,
   `Release: Read`, `Organization: Read`. Save, copy the token.
3. `echo 'SENTRY_API_TOKEN=<token>' >> ~/.config/devin/sentry.env`

API helpers used throughout:

    BASE="https://de.sentry.io/api/0"
    AUTH="Authorization: Bearer $SENTRY_API_TOKEN"
    ORG="django-apps-ted"
    PROJECT="django-apps-web"

## 1. Fetch the work queue

    curl -s -H "$AUTH" \
      "$BASE/projects/$ORG/$PROJECT/issues/\
?query=is:unresolved+level:error+environment:production\
&statsPeriod=14d&sort=freq"

Only `level:error` browser exceptions are auto-fixable — that
filter IS the queue. Warning-level streams (`reportType:
resource-load` messages) are intentionally excluded. There is no
user-report stream in this project yet, and backend errors live
in the sibling `django-apps-api` project — both out of scope
(see `AGENTS.md` "Sentry event streams").

## 2. Pick and analyze one item

- Default: ONE item per run — the highest-count/recent issue.
  If the user said "fix all", enumerate first and post the list.
- Fetch `GET $BASE/issues/<id>/events/latest/` — exception type,
  sourcemapped stack frames (file/line/function), tags, release
  sha, breadcrumbs.
- Reproduce before fixing. `environment:preview` events never
  reach this queue, so every item should map to prod behavior.
  Can't reproduce → report back to the user and move on; NEVER
  a speculative fix.

## 3. Decide where the fix belongs

Single repo, but a web-project error can still be a backend bug:
an SPA failure can be a ninja API contract change (the
`{error, detail}` shape, `/api/<entry>/` routing, per-user
scoping). If the root cause is in a Django app, fix it there per
the app `AGENTS.md` — same repo, same branch, same PR.

## 4. Branch and fix — in a worktree

    git fetch origin
    git worktree add ../django-apps-wt/sentry-<issue_short_id> \
      -b fix/sentry-<issue_short_id> origin/main
    cd ../django-apps-wt/sentry-<issue_short_id>

Never branch in the main checkout (AGENTS.md) — it may hold
the user's uncommitted work or another agent's session.
Symlink `venv`, `.env`, `frontend/node_modules` etc. from
the main checkout as AGENTS.md describes.

- Read `AGENTS.md` plus the owning app's `AGENTS.md`; 79-char
  lines in every file type.
- `export PATH="/opt/homebrew/bin:$PATH"` on every exec call —
  node/npm/gh are not on the default PATH; `source
  venv/bin/activate` before any `manage.py` command.
- Write a failing test reproducing the event first, then fix.
- Verify scoped, never the whole suite:
  - backend: `python manage.py check`,
    `python manage.py test <app>`
  - frontend (cwd `frontend/`): `npm run lint`,
    `npm run format:check`, `npm run typecheck`,
    `npx vitest run <file>`
- Regenerate `frontend/openapi.json` + `src/*/api-types.ts` when
  any `*/api.py` changed (CI drift-checks both).
- Bump `PWA_CACHE_VERSION` in `django_apps/views.py` when
  shipping frontend changes.
- Update the owning app's `AGENTS.md`/`docs/changelog.md` when
  behavior changed.

## 5. Open the PR

- Stage only files you edited, by path (never `git add -A`);
  `git status` first and leave the user's dirty files alone.
- Commit format `Type: Capitalized message` (usually `Fix:`).
- `git push -u origin <branch>`, then a PR (ready for review,
  never a draft) `--base main` per the `/create-pr` skill —
  body via `--body-file`, never inline `--body`.
- Body must: link the Sentry issue
  (`https://django-apps-ted.sentry.io/issues/<id>/`), quote the
  top stack frame, and include the UI verification / QC section.
- `gh pr checks <N> --watch`; fix until green. Then run the
  reviewer loop: spawn a fresh reviewer subagent on the diff,
  fix useful findings, push, repeat until a round finds
  nothing meaningful. Remove the worktree once the loop is
  clean and checks are green.

## 6. Resolve — only after merge

    curl -s -X PUT -H "$AUTH" \
      -H 'Content-Type: application/json' \
      -d '{"status": "resolvedInNextRelease"}' \
      "$BASE/issues/<id>/"

Release = deploy sha; resolution takes effect on the next
deploy. NEVER resolve before merge; NEVER `ignore` / `archive`
an issue without asking the user.

## Guardrails

- If >3 actionable items exist, post the queue list and let the
  user pick before fixing.
- All work happens in a fresh worktree — never branch in the
  main checkout; follow-up fixes get a fresh worktree too.
- No standing test account exists (login is Google OAuth, the
  owner's account) — reproduce via read-only prod browsing or
  the seeded E2E user, and ask before creating accounts.
- Report at the end: issue handled, PR URL, and Sentry
  resolution status.
