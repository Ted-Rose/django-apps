# Spec Delta

## Purpose

Defines the Google OAuth2 login/callback contract: CSRF
protection via the `state` parameter, safe redirect targets, and
where OAuth credentials may be stored.

## ADDED Requirements

### Requirement: Callback validates the state parameter

The OAuth callback SHALL compare the `state` query parameter
returned by Google against the `state` stored in the session
when the authorization URL was generated, and MUST abort the
flow — before `fetch_token` and before popping
`oauth_scopes`/`oauth_redirect_url` — when they differ or the
session value is absent.

#### Scenario: Forged callback is rejected

- **WHEN** `/google/callback` arrives with a `state` that does
  not match `session['state']` (or no session state exists)
- **THEN** the flow aborts before any token exchange and no
  login occurs

#### Scenario: Matching state proceeds

- **WHEN** the returned `state` equals the stored session value
- **THEN** the callback proceeds to `fetch_token` as today

#### Scenario: Parallel-tab flows may fail closed

- **WHEN** two OAuth flows run in parallel tabs (the single
  `session['state']` slot is overwritten)
- **THEN** the earlier flow's callback fails the state check and
  the user retries — failed-closed is the accepted trade-off

### Requirement: Redirect targets are validated

Any URL taken from request input (`?next=`) or the session
(`oauth_redirect_url`) and used as a redirect target SHALL be
restricted to this site's own pages — validated with
`url_has_allowed_host_and_scheme` for absolute/relative URLs or
resolved as a Django view name — with a fixed internal fallback
(the tasks dashboard) when validation fails.

#### Scenario: External next is ignored

- **WHEN** `/login/?next=https://evil.example` is requested
- **THEN** the user is redirected to the fallback page, never to
  the external host — both for already-authenticated users and
  after the OAuth round-trip

#### Scenario: View-name targets keep working

- **WHEN** the stored redirect value is a view name such as
  `google_tasks:dashboard` (written by sync/complete flows
  rather than a URL)
- **THEN** the callback still resolves and lands on that page

### Requirement: Refresh tokens are not duplicated in session

OAuth credentials SHALL be persisted only in the
`GoogleOAuthCredentials` table; the callback MUST NOT write the
access/refresh token pair into the Django session store.

#### Scenario: Session holds no credential material

- **WHEN** a user completes the OAuth callback
- **THEN** `request.session` contains no `google_credentials`
  token payload (the DB row is the sole at-rest copy)
