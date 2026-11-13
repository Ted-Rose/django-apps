import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import { initI18n } from '../shared/i18n';
import { initSentry } from '../shared/sentry';
import { initGlobalErrorHandlers } from '../shared/errorReporter';
import { fetchSession } from '../shared/session';
import queryClient from '../shared/queryClient';

// Before everything else, so even a failing i18n/module init is
// reported. Both no-op without a DSN (read from #spa-bootstrap —
// the only per-request config the edge-cached HTML carries).
initSentry();
initGlobalErrorHandlers();

// One shared i18next for every app — each lazy chunk registers
// its own catalogs via registerI18n at evaluation.
initI18n();

// Session bootstrap (username/language/is_staff + the csrftoken
// cookie) fired at module evaluation — in parallel with the
// finance chunk below, not after mount.
const sessionPromise = fetchSession();

// Finance is the primary use case: kick its chunk off at startup
// so it is loaded (or in flight) before the user navigates. The
// module-level dynamic import shares the browser's module registry
// with the React.lazy call in App.tsx — one fetch, one eval.
void import('../finance/main');

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      {/* One shared QueryClient — cached data survives
          client-side app-to-app navigation. */}
      <QueryClientProvider client={queryClient}>
        <App sessionPromise={sessionPromise} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
