# Known bug: Cloud Run service created before secret IAM grant

> **For the agent running the GCP project migration** (see
> `MIGRATION.md` / `migrate_to_django_apps.sh`): read this before
> Phase 4 (`terraform apply` of the Cloud Run service + jobs).

## Symptom

Observed 2026-10-02 on project `django-apps-7345`, first-ever
`terraform apply` of the full stack:

- `11:51:56` — `CreateService` for `django-apps`.
- `11:52:03` — revision `django-apps-00001-bj6` stuck at
  `Ready=False`, reason `SecretsAccessCheckFailed`, logged as
  ERROR-severity audit events:

  ```
  Permission denied on secret:
  projects/<num>/secrets/DJANGO_SECRET_KEY/versions/latest for
  Revision service account
  cloudrun-sa@<project>.iam.gserviceaccount.com. The service account
  used must be granted the 'Secret Manager Secret Accessor' role
  (roles/secretmanager.secretAccessor) ...
  ```

  Same message repeated for `DATABASE_URL`, `APP_BASE_URL`,
  `GOOGLE_OAUTH_CLIENT_JSON`, `GOCARDLESS_SECRET_ID`,
  `GOCARDLESS_SECRET_KEY`, `VAPID_PUBLIC_KEY`.
- While no revision is Ready the service URL returns 503 — users
  see this as "500 errors"/site down.
- The stuck revision did **not** self-heal; the service was deleted
  and recreated at ~11:54, by which time the IAM grant existed, and
  the new revision went Ready in ~7s.

Reproduce/diagnose:

```bash
gcloud run services describe django-apps --region=europe-west3 \
  --project=$NEW --format='yaml(status.conditions)'

gcloud logging read \
  'resource.type="cloud_run_revision" AND severity>=ERROR' \
  --project=$NEW --limit=10 --freshness=1d
```

## Root cause

Terraform ordering race. `google_cloud_run_v2_service.django_app`
in `terraform/cloud_run.tf` declared only:

```hcl
depends_on = [
  google_project_service.enabled,
  google_artifact_registry_repository.gae_standard,
]
```

and `service_account = local.cloudrun_email` is a **plain string**
(local), so terraform had no dependency edge to either the service
account or its `secretAccessor` grant. On a fresh project the
service was created in parallel with / before
`google_project_iam_member.cloudrun_secret_accessor`, and Cloud
Run's secret-access check ran before the grant existed (grants also
take ~60s+ to propagate inside GCP).

The three jobs in `terraform/cloud_run_jobs.tf`
(`sync_transactions_job`, `evaluate_limits_job`,
`check_balance_alerts_job`) had the same missing edge — they only
escaped because job creation doesn't probe secret access; a job
created before the grant would fail at **execution** time instead.

## Fix (already in the repo)

`terraform/cloud_run.tf` — service `depends_on` now includes:

```hcl
google_service_account.cloudrun,
google_project_iam_member.cloudrun_secret_accessor,
```

`terraform/cloud_run_jobs.tf` — all three job `depends_on` blocks
now include `google_project_iam_member.cloudrun_secret_accessor`.

**Before applying, verify your checkout contains the fix:**

```bash
grep -n "cloudrun_secret_accessor" \
  terraform/cloud_run.tf terraform/cloud_run_jobs.tf
# expect: 1 hit in cloud_run.tf, 3 in cloud_run_jobs.tf
```

If it doesn't, cherry-pick / rebase onto a commit that has it, or
apply the IAM grant first manually (below).

## Belt-and-suspenders: order the apply explicitly

IAM propagation lag can outlive `depends_on`. On a **fresh**
project, pre-apply the SA + grant and give it a minute:

```bash
cd terraform
terraform apply -auto-approve \
  -target=google_service_account.cloudrun \
  -target=google_project_iam_member.cloudrun_secret_accessor
sleep 90                      # let IAM propagate
terraform apply -auto-approve # service, jobs, scheduler, WIF, ...
```

(Prereqs still stand: secrets must already exist — Phase 2 —
because `secrets.tf` reads them as data sources, and the Artifact
Registry image must exist before the service applies.)

## If it still fails with SecretsAccessCheckFailed

1. Confirm the grant exists:

   ```bash
   gcloud projects get-iam-policy $NEW \
     --flatten='bindings[].members' \
     --filter='bindings.role=roles/secretmanager.secretAccessor' \
     --format='value(bindings.members)'
   # must list serviceAccount:cloudrun-sa@$NEW.iam.gserviceaccount.com
   ```

2. If missing: `terraform apply` the two targets above. If present:
   it's propagation lag — wait 1–2 min.

3. A revision stuck `SecretsAccessCheckFailed` does not recover on
   its own. Delete + re-apply:

   ```bash
   gcloud run services delete django-apps \
     --region=europe-west3 --project=$NEW --quiet
   terraform apply -auto-approve   # recreates it
   ```

4. Verify: `status.conditions` shows `Ready: True`, then
   `curl -sI $URL | head -1` → `HTTP/2 200` or `302`.
