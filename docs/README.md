# docs/ — documentation map

- `QUICKSTART.md` — GCP/Cloud Run deploy runbook (**partially
  stale** — see its status banner; Terraform + GitHub Actions own
  deploys now).
- `VERCEL_SETUP.md` — Vercel project env-var reference (runtime +
  build-time) and post-deploy checklist. Current.
- `changelog.md` — user-visible change log, append-only.
- `coding_diary.md` — development log, append-only history
  (PythonAnywhere-era entries included).
- `plans/` — **frozen** historical design docs. Nothing new is
  added; each carries a `Status:` header. All new planning goes
  through `openspec changes` (see `openspec/` and `AGENTS.md`).
- `research/` — durable analysis/runbooks that are NOT
  implementation plans: `security-audit.md` (codebase audit with
  per-finding status), `gcp-secrets-iam-race.md` (Cloud Run
  secret-IAM ordering post-mortem + recovery runbook).
