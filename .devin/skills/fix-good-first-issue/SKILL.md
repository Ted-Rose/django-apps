---
name: fix-good-first-issue
description: >
  Pick an open GitHub issue labeled "good first issue", implement
  the fix on a feature branch, and open a draft PR that closes it.
  Use when asked to grab a starter issue, fix a good-first-issue,
  or work the issue backlog in Ted-Rose/django-apps.
---

# Fix a "good first issue"

1. Prereq: `gh` CLI installed and authenticated
   (`gh auth status`). If it is missing, tell the user to run
   `brew install gh && gh auth login` — do not work around it.
2. List candidates (repo flag: `--repo Ted-Rose/django-apps`):
   `gh issue list --label "good first issue" --state open`.
   If none are open, say so and stop.
3. Pick one (the issue the user named, else the oldest). Verify no
   PR already covers it:
   `gh pr list --repo Ted-Rose/django-apps --state all --search "#<N>"`
   If a merged or open PR covers it, pick another issue.
4. Read the issue fully — `gh issue view <N> --comments` — plus
   the owning app's `AGENTS.md`. This is a single repo; decide
   which app owns the fix, not which repo.
5. Sync and branch:
   `git checkout main && git pull` then
   `git checkout -b fix/issue-<N>-<slug>` (short kebab slug).
6. Implement per the root `AGENTS.md`: per-user scoping, ninja
   `{error, detail}` contract, ≤79 chars, `makemigrations` only
   (never `migrate` against a real DB).
7. Verify with scoped tests only: `python manage.py test <app>`,
   `npx vitest run <file>` for touched frontend code,
   `npm run lint` / `typecheck` / `format:check` when
   `frontend/` changed. Regenerate `frontend/openapi.json` +
   `api-types.ts` if any `*/api.py` changed.
8. Commit `Fix: <message>` — stage only files you changed, by
   path; `git status` first; leave user files alone.
9. Push the branch and open a DRAFT PR using the `/create-pr`
   workflow (body via `--body-file`, never inline). The body must
   contain `Closes #<N>` and the UI verification / QC section.
10. `gh pr checks --watch` until green; fix failures on the same
    branch and push again. Then `gh pr ready`.
11. Report: issue URL, PR URL, and final check status.
