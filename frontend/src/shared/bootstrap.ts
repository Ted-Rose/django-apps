/**
 * Payload rendered by `spa_shell.html` via
 * `{{ bootstrap|json_script:"spa-bootstrap" }}`. The shell is
 * edge-cached and byte-identical for all users, so only
 * user-agnostic deployment config rides in it — the Sentry init
 * values the web SDK needs before app modules import. Per-user
 * context (username/language/is_staff) arrives via `GET /api/me/`
 * (see `shared/session.ts`), which also plants the csrftoken
 * cookie.
 */
export interface BootstrapPayload {
  sentry?: {
    dsn?: string | null;
    environment?: string | null;
    release?: string | null;
  };
}

/**
 * Reads and parses the `#spa-bootstrap` json_script payload —
 * plain (non-hook) so it is callable before `createRoot` too.
 * Returns {} when the node is absent or its JSON is broken.
 */
export function readBootstrap(): BootstrapPayload {
  const el = document.getElementById('spa-bootstrap');
  if (!el || !el.textContent) return {};
  try {
    return JSON.parse(el.textContent) as BootstrapPayload;
  } catch {
    return {};
  }
}
