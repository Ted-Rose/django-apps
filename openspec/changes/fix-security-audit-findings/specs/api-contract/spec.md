# Spec Delta

## Purpose

Extends the error-envelope rule from unhandled exceptions to
handled failures: internal exception text and upstream response
bodies must not reach clients through `detail` — including via
`_adapt`'s passthrough of legacy `{'error': …}` view payloads.

## ADDED Requirements

### Requirement: Handled failures return generic detail

When an endpoint or a delegated legacy view catches an exception
and returns a failure payload, the client-visible error text
SHALL be a fixed, user-meaningful message — raw `str(exc)` output
and embedded upstream response bodies MUST NOT appear in
`detail` (or any other response field). Full exception detail
goes to logs and the `internal_error` Sentry stream.

#### Scenario: View-level str(e) no longer leaks

- **WHEN** a `google_tasks` JSON view (e.g. sync, reorder,
  create) raises and its legacy handler builds a failure
  payload
- **THEN** the adapted API response carries a generic `detail`,
  not the exception text

#### Scenario: User-meaningful errors are preserved

- **WHEN** a failure carries a deliberate, user-facing message
  (validation text, "bank must be relinked", i18n `code`)
- **THEN** that message still reaches the client unchanged

#### Scenario: Upstream bodies are not echoed

- **WHEN** a failure wraps an external API error whose body
  contains internals (e.g. a Google/GoCardless response)
- **THEN** the body is logged, not returned
