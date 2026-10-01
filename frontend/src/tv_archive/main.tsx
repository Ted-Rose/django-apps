import 'vite/modulepreload-polyfill';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
// Ported from content_list.html's inline <style> block — feed card
// layout, filter form styling, page background.
import './tv_archive.css';

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
        {/* Stage 1 strangler mount: the SPA lives at /tv-arhivs/app
            while the template keeps serving /tv-arhivs; Stage 3
            flips the basename to "/tv-arhivs" at cutover. */}
        <BrowserRouter basename="/tv-arhivs/app">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
