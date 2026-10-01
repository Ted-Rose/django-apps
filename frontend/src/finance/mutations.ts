/**
 * TanStack Query mutation hooks for POST /api/finance/… — Stage 1
 * keeps this deliberately minimal (sync, balance refresh, apply
 * rules: the fire-and-toast ops); Stages 2–5 add the form-driven
 * mutations (connect, share, limit/rule/category save/delete/move,
 * push subscribe).
 *
 * Cache strategy: every finance query is keyed under the
 * `['finance', …]` prefix, so mutating hooks invalidate that root —
 * the refetched payloads carry the authoritative state. Mutation
 * successes return `{success, message}` which is surfaced as a
 * toast, matching the template UI's django.contrib.messages text.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { apiPost } from '../shared/api/client';
import { errorDetail } from '../shared/api/errors';
import { pushToast } from '../shared/toasts';
import type { RefreshOut, RulesChangedOut, SyncIn, SyncOut } from './api';

const FINANCE_KEY = ['finance'] as const;

function invalidateFinance(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: FINANCE_KEY });
}

/**
 * POST /api/finance/transactions/sync/ — loops `status='LN'`
 * accounts server-side (one request, same as the template button);
 * `{account}` limits the sync to a single account.
 */
export function useSyncTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload?: SyncIn) =>
      apiPost<SyncOut>('/api/finance/transactions/sync/', payload),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Sync failed: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/balances/refresh/ — refetches live balances for
 * every account opted into the balance check.
 */
export function useRefreshBalances() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<RefreshOut>('/api/finance/balances/refresh/'),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to refresh balances: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/rules/apply/ — re-runs the user's ruleset over
 * all visible transactions; the `changed` count arrives inside the
 * success message the API echoes.
 */
export function useApplyRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<RulesChangedOut>('/api/finance/rules/apply/'),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to apply rules: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}
