import { QueryClient } from '@tanstack/react-query';

/**
 * One QueryClient for the whole shell — created here (not in
 * main.tsx) so non-component code like LanguageSwitcher can
 * invalidate queries without a hook context. Options: one retry
 * keeps transient network errors from flashing error states;
 * real failures still surface via ApiError.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default queryClient;
