import {
  lazy,
  Suspense,
  useEffect,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { ErrorBoundary } from '../shared/ErrorBoundary';
import { SessionGate, type SessionResult } from '../shared/session';
import { ShellNavProvider } from '../shared/shellNav';
import Home from './Home';

/**
 * The unified shell: ONE React root, ONE top-level router for the
 * whole site. Every app renders under its URL prefix as a lazy
 * chunk that keeps its own nested `BrowserRouter basename` — so
 * in-app absolute links needed zero changes, and app-to-app
 * navigation is a client-side route change (no document reload).
 *
 * `/` is the dashboard (public, like the old home.html); the shell
 * also serves the two single_pages root mounts /twister + /spoki/.
 */

// Finance is the priority chunk — main.tsx already kicked its
// import off at startup, so this lazy() resolves from the same
// in-flight module load. The rest idle-prefetch after first
// render (see RouteEffects).
const FinanceApp = lazy(() => import('../finance/main'));
const TasksApp = lazy(() => import('../tasks/main'));
const NotesApp = lazy(() => import('../notes/main'));
const GmailApp = lazy(() => import('../gmail/main'));
const SinglePagesApp = lazy(() => import('../single_pages/main'));

function Loading() {
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

function LazyApp({ app: AppComponent }: { app: ComponentType }) {
  return (
    <Suspense fallback={<Loading />}>
      <AppComponent />
    </Suspense>
  );
}

// `<title>` per top-level route — server-side `title` is gone
// with the per-mount page rendering.
function titleFor(pathname: string): string {
  if (pathname === '/') return 'Home';
  if (pathname.startsWith('/tasks')) return 'Tasks';
  if (pathname.startsWith('/finance')) return 'Finance';
  if (pathname.startsWith('/gmail')) return 'Gmail to Audio';
  if (pathname.startsWith('/notes')) return 'Notes';
  return 'Pages';
}

// Remaining app chunks idle-prefetch in this order after the
// first render. Chunks are content-hashed + immutable-cached, so
// the prefetch is a warm cache hit on every later visit.
function prefetchAppChunks(): void {
  const loaders = [
    () => import('../tasks/main'),
    () => import('../notes/main'),
    () => import('../gmail/main'),
    () => import('../single_pages/main'),
  ];
  const ric = (
    window as Window & {
      requestIdleCallback?: (fn: () => void) => number;
    }
  ).requestIdleCallback;
  const schedule = (cb: () => void) => {
    if (ric) {
      ric(() => cb());
    } else {
      window.setTimeout(cb, 1);
    }
  };
  const next = (i: number) => {
    if (i >= loaders.length) return;
    schedule(() => {
      void loaders[i]().then(() => next(i + 1));
    });
  };
  next(0);
}

/**
 * Feeds the OUTER router's navigate into ShellNavContext so app
 * subtrees can cross apps client-side — a basename-scoped
 * `<Link>` inside an app can only ever resolve inside its own
 * prefix, so cross-app anchors go through this instead.
 */
function ShellNavBridge({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return <ShellNavProvider navigate={navigate}>{children}</ShellNavProvider>;
}

/** Per-route document.title + the idle prefetch kick. */
function RouteEffects() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = `${titleFor(pathname)} - Tedis's Tools`;
  }, [pathname]);
  useEffect(() => {
    prefetchAppChunks();
  }, []);
  return null;
}

export default function App({
  sessionPromise,
}: {
  sessionPromise: Promise<SessionResult>;
}) {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <RouteEffects />
        <ShellNavBridge>
          <SessionGate promise={sessionPromise}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/tasks/*" element={<LazyApp app={TasksApp} />} />
              <Route path="/finance/*" element={<LazyApp app={FinanceApp} />} />
              <Route path="/gmail/*" element={<LazyApp app={GmailApp} />} />
              <Route path="/notes/*" element={<LazyApp app={NotesApp} />} />
              <Route
                path="/twister/*"
                element={<LazyApp app={SinglePagesApp} />}
              />
              <Route
                path="/spoki/*"
                element={<LazyApp app={SinglePagesApp} />}
              />
            </Routes>
          </SessionGate>
        </ShellNavBridge>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
