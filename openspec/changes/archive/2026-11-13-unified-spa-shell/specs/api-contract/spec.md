# Spec Delta

## ADDED Requirements

### Requirement: Session bootstrap endpoint

`GET /api/me/` SHALL return the caller's `username`, `language`,
and `is_staff`, and SHALL set the `csrftoken` cookie so an SPA
served from a cookieless edge-cached shell can still issue unsafe
requests. It is the only per-user call the shell makes at
startup; its 401 carries the standard `unauthenticated` +
`login_url` body.

#### Scenario: Authenticated caller receives bootstrap context

- **WHEN** an authenticated user requests `GET /api/me/`
- **THEN** the response is 200 with `username`, `language`, and
  `is_staff`, and the response sets the `csrftoken` cookie

#### Scenario: Anonymous caller receives login_url

- **WHEN** an unauthenticated user requests `GET /api/me/`
- **THEN** the response is 401 `{error: 'unauthenticated',
  login_url: '/admin/login/?next=<spa page>'}`
