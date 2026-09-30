import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// Copied from google_tasks/static/google_tasks/css/dashboard.css for
// visual parity; Stage 6 removes the original. Also provides the fixed
// navbar offset (`body { padding-top: 60px }`).
import './dashboard.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // One retry keeps transient network errors from flashing error
      // states; real failures still surface via ApiError.
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/tasks/app">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
