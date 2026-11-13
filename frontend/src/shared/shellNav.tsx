import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ReactNode,
} from 'react';

/**
 * Shell-level navigation channel — carries the OUTER router's
 * `navigate` down into app subtrees.
 *
 * Apps render under `AppRouter`, whose basename scopes every
 * react-router primitive to the app's own prefix: a plain
 * `<Link to="/notes/">` inside tasks would resolve to
 * `/tasks/notes/`. Cross-app links therefore used to be
 * `<a href>` full reloads — which threw away the unified shell's
 * headline benefit. Components below the provider instead route
 * same-origin shell paths through this context, so a burger-menu
 * jump from tasks to notes is a client-side route change.
 *
 * `useShellNav()` returns `null` outside the shell (tests,
 * standalone mounts) — callers must keep the plain-anchor
 * fallback so those mounts still navigate.
 */
export type ShellNavigate = (to: string) => void;

const ShellNavContext = createContext<ShellNavigate | null>(null);

export function ShellNavProvider({
  navigate,
  children,
}: {
  navigate: ShellNavigate;
  children: ReactNode;
}) {
  return (
    <ShellNavContext.Provider value={navigate}>
      {children}
    </ShellNavContext.Provider>
  );
}

export function useShellNav(): ShellNavigate | null {
  return useContext(ShellNavContext);
}

// URL prefixes the unified shell router owns (the <Route> list in
// shell/App.tsx). Anything under one of these — or the dashboard
// itself — can be a client-side route change. Everything else
// (/admin/*, /login/, the OAuth flow, external URLs) must stay a
// plain anchor so the browser performs a real navigation.
const SHELL_PREFIXES = [
  '/tasks',
  '/finance',
  '/gmail',
  '/notes',
  '/twister',
  '/spoki',
];

export function isShellPath(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  if (path === '/') return true;
  return SHELL_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

interface ShellLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

/**
 * `<a>` that upgrades shell-owned destinations to client-side
 * navigation when rendered inside the unified shell, and stays a
 * plain anchor everywhere else — href always carries the real
 * URL, so /admin/*, OAuth and external links work unchanged and
 * middle-/modifier-click opens a new tab like any anchor.
 */
export function ShellLink({ href, onClick, ...rest }: ShellLinkProps) {
  const shellNav = useShellNav();
  return (
    <a
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          !shellNav ||
          !isShellPath(href)
        ) {
          return;
        }
        event.preventDefault();
        shellNav(href);
      }}
      {...rest}
    />
  );
}
