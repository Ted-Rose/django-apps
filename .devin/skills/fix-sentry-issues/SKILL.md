---
name: fix-sentry-issues
description: Pull unresolved production errors from BOTH Sentry
  projects (django-apps-api backend + django-apps-web frontend),
  and work the queue one issue at a time — reproduce, fix on a
  branch cut from main, open a draft PR, have a fresh reviewer
  subagent review it, fixer subagents iterate, then squash-merge
  when checks are green and review is clean. Mark each Sentry
  issue resolved only after its PR merges. Invoke when the user
  asks to fix Sentry issues / triage the Sentry queue in
  django-apps.
---

# Fix unresolved Sentry issues (all projects)

Target repo: this one — `Ted-Rose/django-apps` (remote `origin`,
the owner's own repo, not a fork; default branch `main`). The
Sentry org is `django-apps-ted`, hosted in the **EU region —
`https://de.sentry.io`**, NOT sentry.io. BOTH projects are in
scope:

- `django-apps-api` (python-django) — unhandled 500s plus caught
  bugs reported via `capture_internal_exception`
  (`error_code:internal_error`).
- `django-apps-web` (javascript-react) — browser exceptions from
  the SPAs.

`is:unresolved level:error environment:production` IS the queue.
Warning-level streams (`reportType:resource-load` messages) and
`environment:preview` events are intentionally excluded. See
`AGENTS.md` "Sentry event streams" for the full taxonomy.

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

## 1. Fetch the work queue — both projects

    for PROJECT in django-apps-api django-apps-web; do
      curl -s -H "$AUTH" \
        "$BASE/projects/$ORG/$PROJECT/issues/\
?query=is:unresolved+level:error+environment:production\
&statsPeriod=14d&sort=freq"
    done

Enumerate the combined queue and post the list. Default mode:
work the WHOLE queue, one issue at a time, highest event count
first. If the user named a single issue, fix just that one. An
empty queue means a one-line "queue is empty" report and stop.

## 2. Work issues ONE AT A TIME

Strictly sequential — one branch, one PR, one merge at a time,
each cut from a fresh `main` (prior merges move it).

For each issue:

- Fetch `GET $BASE/issues/<id>/events/latest/` — exception type,
  sourcemapped stack frames (file/line/function), tags, release
  sha, breadcrumbs.
- Reproduce before fixing. Can't reproduce → skip it, note why
  in the final report; NEVER a speculative fix.
- Root cause decides where the fix lands, not which project
  reported it: a web error can be a ninja API contract bug (the
  `{error, detail}` shape, `/api/<entry>/` routing, per-user
  scoping); an api 500 can start as SPA misuse. Fix where the
  cause is, per the owning app's `AGENTS.md`.
- Branch and fix:

      git switch main && git pull --ff-only
      git switch -c fix/sentry-<short_id>

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

## 3. Draft PR

- Stage only files you edited, by path (never `git add -A`);
  `git status` first and leave the user's dirty files alone.
- Commit format `Type: Capitalized message` (usually `Fix:`).
- `git push -u origin <branch>`, then a DRAFT PR `--base main`
  per the `/create-pr` skill — body via `--body-file`, never
  inline `--body`.
- Body must: link the Sentry issue
  (`https://django-apps-ted.sentry.io/issues/<id>/`), quote the
  top stack frame, and include the UI verification / QC section.
- `gh pr checks <N> --watch`; fix until green; `gh pr ready`.

## 4. Review with a fresh agent

- Launch a FRESH reviewer subagent (`subagent_explore` profile)
  that never saw the implementation. Prompt it with `gh pr diff
  <N>`, the repo rules, and the Sentry event details. It must
  return findings tagged `[blocker]`, `[major]`, `[minor]`,
  `[nit]`, or the exact string `NO ISSUES`.
- `[blocker]`/`[major]` → launch a fixer subagent
  (`subagent_general`) that pushes fixes on the same branch, then
  run a new review round. Repeat until `NO ISSUES` (or only
  `[minor]`/`[nit]`) — max 3 rounds, then stop and report
  remaining findings.
- Never reuse the implementer as its own reviewer.
- QUICK FIX escape hatch: if the diff is small and
  self-evidently correct — a null guard, a typo, a one-line fix
  with a test — you may skip the reviewer agent and self-check
  instead. Say in the report that you did.

## 5. Merge policy

The user authorized auto-merge. Merge immediately when BOTH hold:

- `gh pr checks` is green, AND
- review is clean (`NO ISSUES` or only `[minor]`/`[nit]`) or the
  quick-fix escape hatch applied.

    gh pr merge <N> --squash --delete-branch

Every merge to `main` deploys — that is expected and authorized;
the bar is green checks + clean review, nothing else. If
`[blocker]`/`[major]` findings remain after 3 rounds: leave the
PR open as draft, note it in the report, move to the next issue.

## 6. Resolve in Sentry — only after merge

    curl -s -X PUT -H "$AUTH" \
      -H 'Content-Type: application/json' \
      -d '{"status": "resolvedInNextRelease"}' \
      "$BASE/issues/<id>/"

Release = deploy sha; resolution takes effect on the next
deploy. NEVER resolve before merge; NEVER `ignore` / `archive`
an issue without asking the user.

## Guardrails

- If the queue is large (>5 actionable items), post the list and
  confirm scope with the user before burning through all of it.
- Can't reproduce → skip and report; NEVER a speculative fix.
- If the working tree has unrelated dirty files that block
  `git switch main`, stop and ask.
- No standing test account exists (login is Google OAuth, the
  owner's account) — reproduce via read-only prod browsing or
  the seeded E2E user, and ask before creating accounts.
- Background subagents cannot gain permissions: if one is
  blocked on a denied tool call, resume it in the foreground
  (`run_subagent` with `resume=<agent_id>`).
- Report at the end, one line per issue: Sentry id + title, PR
  URL, merged/skipped + reason, Sentry resolution status.
