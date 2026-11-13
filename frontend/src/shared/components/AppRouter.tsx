import { useContext, useMemo, type ReactNode } from 'react';
import {
  UNSAFE_LocationContext,
  UNSAFE_NavigationContext,
  UNSAFE_RouteContext,
  useLocation,
  useNavigationType,
} from 'react-router-dom';

/**
 * A basename router *segment* — the react-router v7 replacement
 * for the forbidden nested `<BrowserRouter basename>`.
 *
 * v7 throws on `<Router>` inside `<Router>`, but every app was
 * written against basename semantics: absolute `to`/`navigate`
 * targets like `/starred` must resolve to `/tasks/starred`, and
 * `location.pathname` inside the app is the path *relative to*
 * its mount. `<Router basename>` implemented exactly that by
 * publishing three contexts: NavigationContext carries the
 * basename (useHref/useNavigate prepend it), LocationContext
 * carries the stripped location (useLocation/Routes see
 * app-relative paths), and RouteContext starts an empty match
 * list (descendant <Routes> match top-level-style absolute
 * paths). This component publishes the same three values around
 * an app subtree — same behavior, no nested router.
 *
 * App internals therefore needed ZERO changes when the standalone
 * entries became shell routes.
 */

// Byte-identical to react-router's internal stripBasename
// (not exported): exact or segment-boundary prefix only.
function stripBasename(pathname: string, basename: string): string | null {
  if (basename === '/') return pathname;
  if (!pathname.toLowerCase().startsWith(basename.toLowerCase())) {
    return null;
  }
  const startIndex = basename.endsWith('/')
    ? basename.length - 1
    : basename.length;
  const nextChar = pathname.charAt(startIndex);
  if (nextChar && nextChar !== '/') return null;
  return pathname.slice(startIndex) || '/';
}

export function AppRouter({
  basename,
  children,
}: {
  basename: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const navigationType = useNavigationType();
  // The real navigator (history object) — only the basename is
  // overridden so resolved `to` values are app-prefixed while
  // pushes still write the true URL the shell router owns.
  const parentNav = useContext(UNSAFE_NavigationContext);

  const navigation = useMemo(
    () => ({ ...parentNav, basename }),
    [parentNav, basename],
  );

  const stripped = stripBasename(location.pathname, basename);
  const locationValue = useMemo(
    () =>
      stripped == null
        ? null
        : {
            location: { ...location, pathname: stripped },
            navigationType,
          },
    [stripped, location, navigationType],
  );

  // A fresh match list: the app's <Routes> then match their own
  // absolute paths top-level-style, exactly as under basename.
  // isDataRoute=false — the shell is a declarative router.
  const routeValue = useMemo(
    () => ({ matches: [], outlet: null, isDataRoute: false }),
    [],
  );

  // Mirrors <Router>: render nothing when the URL is outside the
  // basename (can't happen — shell routes only mount us under it).
  if (locationValue == null) return null;

  return (
    <UNSAFE_NavigationContext.Provider value={navigation}>
      <UNSAFE_LocationContext.Provider value={locationValue}>
        <UNSAFE_RouteContext.Provider value={routeValue}>
          {children}
        </UNSAFE_RouteContext.Provider>
      </UNSAFE_LocationContext.Provider>
    </UNSAFE_NavigationContext.Provider>
  );
}
