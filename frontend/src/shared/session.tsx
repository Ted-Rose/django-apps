import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';

import i18n, { isSupportedLanguage, LANG_OVERRIDE_KEY } from './i18n';

/**
 * Session bootstrap (`GET /api/me/`). The unified shell's HTML is
 * public and edge-cached — byte-identical for every user — so the
 * per-user context the old json_script bootstrap carried is
 * fetched here instead, once, at shell startup. The endpoint also
 * plants the `csrftoken` cookie the shell view used to set.
 *
 * `fetchSession` deliberately avoids `apiFetch`: that wrapper
 * auto-navigates on any 401, which would bounce anonymous visitors
 * off the public dashboard at `/` before they can see it.
 */
export interface Session {
  username: string;
  language: string;
  is_staff: boolean;
}

export type SessionResult =
  | { status: 'authenticated'; session: Session }
  | { status: 'anonymous' }
  | { status: 'error' };

export async function fetchSession(): Promise<SessionResult> {
  try {
    const resp = await fetch('/api/me/', {
      credentials: 'same-origin',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
    });
    if (resp.status === 401) return { status: 'anonymous' };
    if (!resp.ok) return { status: 'error' };
    const session = (await resp.json()) as Session;
    return { status: 'authenticated', session };
  } catch {
    return { status: 'error' };
  }
}

const SessionContext = createContext<Session | null>(null);

/**
 * The resolved session — `null` for anonymous visitors (e.g. on
 * the public dashboard) and in tests without a SessionGate. App
 * pages only render inside the gate after a 401 has already
 * bounced anonymous users to login, so a null session there means
 * the bootstrap errored, not that the user is signed out.
 */
export function useSession(): Session | null {
  return useContext(SessionContext);
}

// Shell routes an anonymous visitor may see: the dashboard is
// public like the old home.html. Everything else bounces to the
// login page after the bootstrap 401 (client-side equivalent of
// the removed @login_required on the page views).
const PUBLIC_PATHS = new Set(['/']);

/** Full-page navigation — extracted so tests can observe it. */
export function navigateTo(url: string): void {
  window.location.assign(url);
}

/**
 * Replicates the old bootstrap language resolution now that the
 * stored pref arrives asynchronously: `?lang=` override → stored
 * per-user pref → `lang_override` localStorage key → the language
 * initI18n already picked (detector/fallback) stays. Because the
 * pref lands after first paint, applying it can flip the UI's
 * boot language — a deliberate trade: the edge-cached shell can
 * no longer inline the pref into the HTML like the old
 * json_script bootstrap did.
 */
function applySessionLanguage(language: string): void {
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  const override = localStorage.getItem(LANG_OVERRIDE_KEY);
  const pick = [urlLang, language, override].find(isSupportedLanguage);
  if (pick) void i18n.changeLanguage(pick);
}

/**
 * Awaits the session bootstrap promise (fired at shell module
 * evaluation, parallel with the route's chunk import). Renders a
 * loading state while pending, provides the SessionContext once
 * resolved, and navigates anonymous users on non-public paths to
 * `/login/` with `next=<current page>`.
 */
export function SessionGate({
  promise,
  children,
}: {
  promise: Promise<SessionResult>;
  children: ReactNode;
}) {
  const [result, setResult] = useState<SessionResult | null>(null);
  const location = useLocation();

  useEffect(() => {
    let live = true;
    void promise.then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [promise]);

  const session = result?.status === 'authenticated' ? result.session : null;

  useEffect(() => {
    if (result?.status !== 'anonymous') return;
    if (PUBLIC_PATHS.has(location.pathname)) return;
    // /login/ is settings.LOGIN_URL — the Google OAuth entry the
    // old @login_required page views 302'd to, the same target the
    // 401 body's login_url carries and GmailReader's credentials
    // bounce still uses.
    const next = location.pathname + location.search;
    navigateTo(`/login/?next=${encodeURIComponent(next)}`);
  }, [result, location]);

  useEffect(() => {
    if (session) applySessionLanguage(session.language);
  }, [session]);

  if (!result) {
    return (
      <div
        className="d-flex justify-content-center py-5"
        role="status"
        aria-label="Loading"
      >
        <div className="spinner-border text-primary" />
      </div>
    );
  }
  // Anonymous on a protected path: the redirect effect above is
  // already navigating — render nothing so no app queries fire.
  if (result.status === 'anonymous' && !PUBLIC_PATHS.has(location.pathname)) {
    return null;
  }
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}
