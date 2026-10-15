---
name: implement-plan
description: >
  Orchestrate execution of a docs/plans/*-plan.md with subagents —
  implementers cut feature branches and open draft PRs, fresh
  reviewer agents return severity-tagged findings, fixer agents
  iterate until clean. Use when asked to implement an existing
  plan file end-to-end.
---

# Implement a plan with subagents

Orchestrator role — you coordinate; subagents implement and
review.

## Phase 1 — decompose

1. Read the plan file the user named (must live in `docs/plans/`;
   check its `Status:` header — do not start a plan marked
   implemented/reverted without asking).
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
   (`is_background=true`). Each prompt must state: the branch name
   `feat/<slug>-<part>` (one branch per workstream) or the shared
   `feat/<slug>` if the user wants a single PR, the exact file set
   it owns, the shared contract verbatim, the relevant
   `AGENTS.md` rules it must honor (79 cols, commit format,
   no-migrate, staging rules), and the scoped test commands for
   its files.
5. Each implementer commits `Feat:`/`Fix:` commits on its branch
   and opens a DRAFT PR via the `/create-pr` workflow (body file,
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
   subagent on the same branch (fixers for different PRs run in
   parallel; two fixers on the SAME PR run sequentially).
10. After fixes push, run a new review round. Repeat until every
    PR reports `NO ISSUES` (or only `[minor]`/`[nit]`) — max 3
    rounds, then stop and report remaining findings.

## Guardrails

- Background subagents cannot gain permissions: if one is blocked
  on a denied tool call, resume it in the foreground
  (`run_subagent` with `resume=<agent_id>`).
- Update the plan file's `Status:` header (`in progress` →
  `partial`/`implemented`) as part of the docs workstream, and
  commit it on a feature branch like everything else.
- Final report: per PR — URL, branch, review rounds, unresolved
  findings, check status.
