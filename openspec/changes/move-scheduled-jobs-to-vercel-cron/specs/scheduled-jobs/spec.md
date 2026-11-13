# Spec Delta

## Purpose

Defines how scheduled management commands (`run_all_jobs` and its
enabled sub-jobs) are triggered: a bearer-authenticated HTTP
endpoint callable by an external cron instead of GCP-native
scheduling.

## ADDED Requirements

### Requirement: Bearer-authenticated job trigger endpoint

The API SHALL expose a job-trigger endpoint that runs
`run_all_jobs` synchronously and returns a JSON result including
the captured command output.

#### Scenario: Valid token runs the jobs

- **WHEN** a request carries
  `Authorization: Bearer <CRON_SECRET>`
- **THEN** the endpoint invokes `run_all_jobs` and responds 200
  with `{"success": true, "output": ...}`

### Requirement: Token check replaces session auth

The endpoint MUST authenticate via a bearer token compared in
constant time against the `CRON_SECRET` setting; session auth
MUST NOT authenticate it (the caller is a machine). When
`CRON_SECRET` is unset the endpoint SHALL respond 404 so the
surface does not exist where unconfigured.

#### Scenario: Missing or wrong token is rejected

- **WHEN** the bearer token is absent, malformed, or does not
  match `CRON_SECRET`
- **THEN** the endpoint responds 401 without running anything —
  including when a valid user session cookie is present

#### Scenario: Unconfigured deployment hides the endpoint

- **WHEN** `CRON_SECRET` is empty in settings
- **THEN** the endpoint responds 404 to every request

#### Scenario: Job failure surfaces as 500

- **WHEN** `run_all_jobs` raises or reports a failure
- **THEN** the endpoint responds non-2xx so the scheduler retries
  the delivery, and the exception is reported through the
  `internal_error` stream like any other job crash

### Requirement: Scheduling lives outside GCP

The daily run of scheduled jobs SHALL be triggered by an HTTP
call to the job endpoint from an external scheduler (Vercel Cron
Jobs on the production deployment). Once that trigger is live no
GCP Cloud Scheduler job or Cloud Run job SHALL be required for
scheduled job execution.

#### Scenario: Daily fire reaches the jobs

- **WHEN** the configured cron schedule fires on the production
  deployment
- **THEN** the job endpoint runs `run_all_jobs` and the day's
  enabled sub-jobs execute

#### Scenario: Manual trigger works identically

- **WHEN** an operator POSTs to the job endpoint with the bearer
  token from any host that can reach the deployment
- **THEN** the same `run_all_jobs` path executes (no GCP
  credentials needed for triggering)
