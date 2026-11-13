# Spec Delta

## Purpose

Defines transport and host hardening for deployed environments:
secure cookie/redirect flags, HSTS, `ALLOWED_HOSTS` scoping, and
where OAuth-over-HTTP is tolerated (local dev only).

## ADDED Requirements

### Requirement: Cloud deploys send secure transport flags

When running in a cloud environment (GCP or Vercel), the site
SHALL set `SESSION_COOKIE_SECURE` and `CSRF_COOKIE_SECURE`,
SHALL redirect plain HTTP to HTTPS (`SECURE_SSL_REDIRECT`,
safe because `SECURE_PROXY_SSL_HEADER` is configured), and
SHALL emit a `Strict-Transport-Security` header with a small
`max-age` (no `includeSubDomains` to start). None of these
flags SHALL apply to local development.

#### Scenario: Production response carries the flags

- **WHEN** the app serves any response in a cloud environment
- **THEN** session/CSRF cookies carry `Secure`, HTTP requests
  301 to HTTPS, and `Strict-Transport-Security` is present

#### Scenario: Local dev keeps working over HTTP

- **WHEN** the app runs locally (`http://127.0.0.1`, no cloud
  markers)
- **THEN** none of the flags are set, so session cookies still
  work over plain HTTP

### Requirement: OAuth HTTP allowance is local-only

`OAUTHLIB_INSECURE_TRANSPORT` SHALL be set only when the
configured `BASE_URL` uses `http://` (local development); it
MUST NOT be set in environments serving HTTPS.

#### Scenario: Production does not downgrade OAuth

- **WHEN** the app runs with an `https://` `BASE_URL`
- **THEN** `OAUTHLIB_INSECURE_TRANSPORT` is absent from the
  environment and oauthlib enforces HTTPS

#### Scenario: Local OAuth still works over HTTP

- **WHEN** `BASE_URL` is `http://…` regardless of `DEBUG`
- **THEN** the flag is set so local OAuth flows don't fail

### Requirement: ALLOWED_HOSTS names real hostnames

`ALLOWED_HOSTS` SHALL list the deployment's actual hostnames
(the exact Cloud Run service URL and the live Vercel domain)
plus localhost/loopback for dev — wildcard platform domains
(`.vercel.app`, `.appspot.com`, `.run.app`) SHALL NOT be
accepted.

#### Scenario: Foreign-tenant Host header is rejected

- **WHEN** a request arrives with a `Host` on a platform
  wildcard domain that isn't this service's hostname
- **THEN** Django rejects it (400)

#### Scenario: Real hostnames keep working

- **WHEN** a request targets the Cloud Run or Vercel hostname,
  or localhost
- **THEN** it passes the `ALLOWED_HOSTS` check
