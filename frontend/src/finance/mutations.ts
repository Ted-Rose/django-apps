/**
 * TanStack Query mutation hooks for POST /api/finance/… — Stage 1
 * added the fire-and-toast ops (sync, balance refresh, apply
 * rules); Stage 2 adds the accounts/connect ops (toggle balance
 * check, share, connect bank); Stage 4 adds the rules/categories
 * ops (rule save/delete/move/preview, category save/delete);
 * Stage 5 adds the rest (limit save/delete, push subscribe).
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
import type {
  CategorySaveIn,
  ConnectIn,
  ConnectOut,
  MessageOut,
  MoveRuleIn,
  RefreshOut,
  RulePreviewIn,
  RulePreviewOut,
  RuleSaveIn,
  RulesChangedOut,
  ShareIn,
  SyncIn,
  SyncOut,
  ToggleBalanceCheckOut,
} from './api';

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
 * POST /api/finance/connect/ — creates the GoCardless requisition
 * server-side (requisition_id lands in the session for the
 * /finance/callback/ Django view) and returns the bank consent
 * `link`. The browser navigates to it directly — fetch must never
 * follow the GoCardless redirect (same rule as Google OAuth).
 */
export function useConnectBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (institutionId: string) =>
      apiPost<ConnectOut>('/api/finance/connect/', {
        institution_id: institutionId,
      } satisfies ConnectIn),
    onSuccess: (data) => {
      if (data?.link) {
        window.location.assign(data.link);
      } else {
        pushToast('Bank link missing from the response.', 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Could not start bank link: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/accounts/{id}/toggle-balance-check/ — flips the
 * caller's own `included_in_balance_check` preference (owners and
 * sharers each have one — the API scopes it to `for_user`).
 */
export function useToggleBalanceCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) =>
      apiPost<ToggleBalanceCheckOut>(
        `/api/finance/accounts/${accountId}/toggle-balance-check/`,
      ),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        `Failed to update balance check: ${errorDetail(error)}`,
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/accounts/{id}/share/ — owner-only; grants the
 * target user read access and creates their default preference.
 */
export function useShareAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { accountId: number; username: string }) =>
      apiPost<MessageOut>(
        `/api/finance/accounts/${variables.accountId}/share/`,
        { username: variables.username } satisfies ShareIn,
      ),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to share account: ${errorDetail(error)}`, 'warning'),
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

/**
 * POST /api/finance/rules/save/ — create or update a rule; the API
 * re-applies rules over history server-side and echoes the
 * recategorized count inside `message`.
 */
export function useSaveRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RuleSaveIn) =>
      apiPost<RulesChangedOut>('/api/finance/rules/save/', payload),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to save rule: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/rules/{id}/delete/ — deletes the rule then
 * re-applies rules; `message` carries the changed count.
 */
export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: number) =>
      apiPost<RulesChangedOut>(`/api/finance/rules/${ruleId}/delete/`),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to delete rule: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/rules/{id}/move/ — swaps a rule with its
 * priority neighbour; the API renumbers priorities 1..n and
 * re-applies rules. Out-of-bounds moves come back with an empty
 * `message`, which the toast guard skips.
 */
export function useMoveRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: {
      ruleId: number;
      direction: MoveRuleIn['direction'];
    }) =>
      apiPost<RulesChangedOut>(`/api/finance/rules/${variables.ruleId}/move/`, {
        direction: variables.direction,
      } satisfies MoveRuleIn),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to move rule: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/rules/preview/ — read-only dry run of a
 * candidate rule. No toasts: the drawer renders the result inline
 * (including API errors, like the template JS rendered
 * `data.error` in the summary line) and nothing is invalidated.
 */
export function usePreviewRule() {
  return useMutation({
    mutationFn: (payload: RulePreviewIn) =>
      apiPost<RulePreviewOut>('/api/finance/rules/preview/', payload),
  });
}

/**
 * POST /api/finance/categories/save/ — create a category (or update
 * its color when the name already exists — update_or_create keyed
 * on (user, name)).
 */
export function useSaveCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CategorySaveIn) =>
      apiPost<MessageOut>('/api/finance/categories/save/', payload),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to save category: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/categories/{id}/delete/ — deletes the category
 * then re-applies rules; `message` carries the changed count.
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) =>
      apiPost<RulesChangedOut>(`/api/finance/categories/${categoryId}/delete/`),
    onSuccess: (data) => {
      if (data?.message) {
        pushToast(data.message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(`Failed to delete category: ${errorDetail(error)}`, 'warning'),
    onSettled: () => invalidateFinance(queryClient),
  });
}
