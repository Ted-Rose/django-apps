---
name: implement-plan
description: >
  Orchestrate execution of a PRE-EXISTING docs/plans/*-plan.md
  with subagents — implementers cut feature branches and open
  PRs, fresh reviewer agents return severity-tagged
  findings, fixer agents iterate until clean. Use only when
  asked to implement an existing plan file end-to-end;
  docs/plans/ is frozen, so new planning goes through openspec
  changes instead.
---

# Implement a plan with subagents

Orchestrator role — you coordinate; subagents implement and
review.

## Phase 1 — decompose

1. Read the plan file the user named (must be a pre-existing
   file in `docs/plans/`, which is frozen — if the user has no
   plan file yet, route them to `openspec changes` instead of
   writing one; check its `Status:` header — do not start a
   plan marked implemented/reverted without asking).
2. Extract: branch slug (`feat/<slug>`), the list of Django apps /
   frontend entries / infra it touches, and the contract between
   those parts (API shapes, URL slugs, schema fields) that every
   implementer must code against verbatim.
3. Split the work into workstreams with **disjoint file sets**
   (typically: one per Django app, one for `frontend/src/<entry>`,
   one for docs/terraform). Two agents must never write the same
   files concurrently — this single repo has no per-repo boundary,
   so the file-set split is the boundary.

## Phase 2 — implement

4. Launch one **background** subagent per workstream
   (`is_background=true`). Each works in its own worktree —
   instruct it to `git fetch origin` then `git worktree add
   ../django-apps-wt/<slug>-<part> -b <branch> origin/main`
   and do all work inside it (symlink `venv`/`.env`/
   `frontend/node_modules` per AGENTS.md). Each prompt must
   state: the branch name
   `feat/<slug>-<part>` (one branch per workstream) — a shared
   `feat/<slug>` for a single PR is only valid with ONE
   implementer/worktree (a branch can't be checked out in two
   worktrees) — the exact file set
   it owns, the shared contract verbatim, the relevant
   `AGENTS.md` rules it must honor (79 cols, commit format,
   no-migrate, staging rules), and the scoped test commands for
   its files.
5. Each implementer commits `Feat:`/`Fix:` commits on its branch
   and opens a PR via the `/create-pr` workflow (body file,
   UI verification section). They report branch + PR URL.
6. If a workstream turns out unimplementable as planned, stop the
   whole run and ask the user — do not let agents improvise a
   redesign.

## Phase 3 — review

7. Once implementers finish, launch a FRESH reviewer subagent per
   PR (`subagent_explore` profile is enough) that has never seen
   the implementation. Prompt it with: the PR diff (`gh pr diff`),
   the plan's contract for that workstream, and the repo rules.
   It returns findings tagged `[blocker]`, `[major]`, `[minor]`,
   `[nit]`, or the exact string `NO ISSUES`.
8. Never reuse an implementer as its own reviewer.

## Phase 4 — fix loop

9. For each PR with `[blocker]`/`[major]` findings, launch a fixer
   subagent on the same branch in a FRESH worktree — a branch can
   live in only one worktree, so remove the implementer's first
   (`git worktree remove ../django-apps-wt/<slug>-<part>
   --force`), then the fixer adds one on the existing branch
   (`git worktree add ../django-apps-wt/fix-<slug>-<part>
   feat/<slug>-<part>`). Fixers for different PRs run in
   parallel; two fixers on the SAME PR run sequentially.
10. After fixes push, run a new review round. Repeat until every
    PR reports `NO ISSUES` (or only `[minor]`/`[nit]`) — max 3
    rounds, then stop and report remaining findings.

## Guardrails

- `docs/plans/` is frozen: this skill executes existing plan
  files only — never create new `*-plan.md` or other planning
  docs; new planning goes through `openspec changes`.
- Background subagents cannot gain permissions: if one is blocked
  on a denied tool call, resume it in the foreground
  (`run_subagent` with `resume=<agent_id>`).
- Update the plan file's `Status:` header (`in progress` →
  `partial`/`implemented`) as part of the docs workstream, and
  commit it on a feature branch like everything else.
- Once a PR's review loop is clean AND its checks are green,
  remove every worktree created for it immediately
  (`git worktree remove ../django-apps-wt/<slug>-<part>
  --force` + `git branch -D feat/<slug>-<part>` from the main
  checkout) — don't wait for merge; fixer/reviewer rounds get
  fresh worktrees.
- Final report: per PR — URL, branch, review rounds, unresolved
  findings, check status, worktree removed (yes/no).
