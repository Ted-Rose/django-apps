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
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { apiPost } from '../shared/api/client';
import { ApiError, errorDetail } from '../shared/api/errors';
import { serverText } from '../shared/i18n';
import { pushToast } from '../shared/toasts';
import type {
  AssignCategoryIn,
  BalanceAlertSaveIn,
  CategorySaveIn,
  ConnectIn,
  ConnectOut,
  ExclusionIn,
  LimitSaveIn,
  MessageOut,
  MoveRuleIn,
  RefreshOut,
  RulePreviewIn,
  RulePreviewOut,
  RuleSaveIn,
  RulesChangedOut,
  ShareIn,
  SyncAccountOut,
  SyncIn,
  SyncOut,
  ToggleBalanceCheckOut,
} from './api';

const FINANCE_KEY = ['finance'] as const;

function invalidateFinance(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: FINANCE_KEY });
}

/**
 * Toast body for a mutation response: `code`/`params` resolve via the
 * `server` catalog namespace; the English `message` is the fallback
 * while the backend rolls codes out.
 */
function resultMessage(
  data:
    | { code?: string | null; params?: unknown; message?: string | null }
    | null
    | undefined,
): string | undefined {
  return serverText(
    data as { code?: string | null; params?: Record<string, unknown> | null },
    data?.message,
  );
}

/** The sync response's sentence is composed from per-count plural
 *  fragments (LV needs count-aware forms for each clause). */
function syncMessage(t: TFunction, data: SyncOut): string | undefined {
  if (data?.code !== 'synced') return undefined;
  const head = t('server:syncedNew', { count: data.created });
  const tail = data.failed
    ? t('server:syncedFailedNote', { count: data.failed })
    : t('server:syncedUpdatedNote', { count: data.updated });
  return `${head}${data.failed ? ', ' : ' '}${tail}.`;
}

/** One line of the per-account sync breakdown toast. */
function syncAccountLine(t: TFunction, a: SyncAccountOut): string {
  if (a.status === 'synced') {
    return t('server:syncAccountSynced', {
      count: a.created,
      account: a.account,
      updatedNote: t('server:syncedUpdatedNote', { count: a.updated }),
    });
  }
  return t('server:syncAccountStatus', {
    account: a.account,
    statusLabel: t(`server:syncStatus.${a.status}`),
    detail: a.code ? (serverText(a, a.detail) ?? a.detail) : a.detail,
  });
}

/** The refresh response joins per-outcome clauses with '; '. */
function refreshMessage(t: TFunction, data: RefreshOut): string | undefined {
  if (data?.code !== 'balancesRefreshed') return undefined;
  const parts: string[] = [];
  if (data.updated) {
    parts.push(t('server:balancesUpdated', { count: data.updated }));
  }
  if (data.rate_limited) {
    parts.push(t('server:balancesRateLimited', { count: data.rate_limited }));
  }
  if (data.failed) {
    parts.push(t('server:balancesFailed', { count: data.failed }));
  }
  return parts.length ? `${parts.join('; ')}.` : undefined;
}

/**
 * POST /api/finance/transactions/sync/ — loops `status='LN'`
 * accounts server-side (one request, same as the template button).
 * The body is optional; `{account}` echoes the current filter back
 * like the template form did — the sync itself is not scoped by it.
 */
export function useSyncTransactions() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload?: SyncIn) =>
      apiPost<SyncOut>('/api/finance/transactions/sync/', payload),
    onSuccess: (data) => {
      const message = syncMessage(t, data) ?? resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
      // Per-account breakdown — the aggregate message alone can't
      // distinguish "fetched, nothing new" from "skipped/failed".
      const breakdown = (data?.accounts ?? [])
        .map((a) => syncAccountLine(t, a))
        .join(' · ');
      if (breakdown) pushToast(breakdown, 'info');
    },
    onError: (error) =>
      pushToast(
        t('mutations.syncFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/balances/refresh/ — refetches live balances for
 * every account opted into the balance check.
 */
export function useRefreshBalances() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<RefreshOut>('/api/finance/balances/refresh/'),
    onSuccess: (data) => {
      const message = refreshMessage(t, data) ?? resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.refreshFailed', { detail: errorDetail(error) }),
        'warning',
      ),
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
  const { t } = useTranslation('finance');
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
        pushToast(t('mutations.bankLinkMissing'), 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.connectFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/accounts/{id}/toggle-balance-check/ — flips the
 * caller's own `included_in_balance_check` preference (owners and
 * sharers each have one — the API scopes it to `for_user`).
 */
export function useToggleBalanceCheck() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) =>
      apiPost<ToggleBalanceCheckOut>(
        `/api/finance/accounts/${accountId}/toggle-balance-check/`,
      ),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.balanceCheckFailed', { detail: errorDetail(error) }),
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
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { accountId: number; username: string }) =>
      apiPost<MessageOut>(
        `/api/finance/accounts/${variables.accountId}/share/`,
        { username: variables.username } satisfies ShareIn,
      ),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.shareFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/accounts/{id}/balance-alert/ — saves the
 * caller's low-balance threshold (owned or shared account). A save
 * resets the episode flag server-side so the next breach alerts.
 */
export function useSaveBalanceAlert() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { accountId: number; threshold: string }) =>
      apiPost<MessageOut>(
        `/api/finance/accounts/${variables.accountId}/balance-alert/`,
        { threshold: variables.threshold } satisfies BalanceAlertSaveIn,
      ),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.alertSaveFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/accounts/{id}/balance-alert/delete/ — removes
 * the caller's alert; the row is per-user so sharers keep theirs.
 */
export function useDeleteBalanceAlert() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: number) =>
      apiPost<MessageOut>(
        `/api/finance/accounts/${accountId}/balance-alert/delete/`,
      ),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.alertRemoveFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/rules/apply/ — re-runs the user's ruleset over
 * all visible transactions; the `changed` count arrives inside the
 * success message the API echoes.
 */
export function useApplyRules() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<RulesChangedOut>('/api/finance/rules/apply/'),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.applyFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/rules/save/ — create or update a rule; the API
 * re-applies rules over history server-side and echoes the
 * recategorized count inside `message`.
 */
export function useSaveRule() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RuleSaveIn) =>
      apiPost<RulesChangedOut>('/api/finance/rules/save/', payload),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.ruleSaveFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/rules/{id}/delete/ — deletes the rule then
 * re-applies rules; `message` carries the changed count.
 */
export function useDeleteRule() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: number) =>
      apiPost<RulesChangedOut>(`/api/finance/rules/${ruleId}/delete/`),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.ruleDeleteFailed', { detail: errorDetail(error) }),
        'warning',
      ),
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
  const { t } = useTranslation('finance');
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
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.ruleMoveFailed', { detail: errorDetail(error) }),
        'warning',
      ),
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
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CategorySaveIn) =>
      apiPost<MessageOut>('/api/finance/categories/save/', payload),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.categorySaveFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/categories/{id}/delete/ — deletes the category
 * then re-applies rules; `message` carries the changed count.
 */
export function useDeleteCategory() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) =>
      apiPost<RulesChangedOut>(`/api/finance/categories/${categoryId}/delete/`),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.categoryDeleteFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/limits/save/ — create or edit (`limit_id`) a
 * TransactionLimit spanning one or more accounts, validated
 * server-side by TransactionLimitForm. A same-category limit
 * already covering any selected account comes back as a 409 —
 * toast its `detail` verbatim, like the template's
 * `messages.error`.
 */
export function useSaveLimit() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LimitSaveIn) =>
      apiPost<MessageOut>('/api/finance/limits/save/', payload),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        error instanceof ApiError && error.status === 409
          ? errorDetail(error)
          : t('mutations.limitSaveFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/transactions/{id}/category/ — writes the
 * caller's manual `UserTransactionCategory` row (`is_manual`,
 * rules never touch it). `categoryId: null` locks the transaction
 * as uncategorized instead.
 */
export function useAssignCategory() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { txId: number; categoryId: number | null }) =>
      apiPost<MessageOut>(
        `/api/finance/transactions/${variables.txId}/category/`,
        { category: variables.categoryId } satisfies AssignCategoryIn,
      ),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.categoryAssignFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/transactions/{id}/category/clear/ — unsets
 * `is_manual` and re-runs the caller's rules on that one
 * transaction, so the badge shows the rules' result immediately.
 */
export function useClearManualCategory() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (txId: number) =>
      apiPost<MessageOut>(`/api/finance/transactions/${txId}/category/clear/`),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.categoryRevertFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/transactions/{id}/exclusion/ — writes the
 * caller's per-transaction excluded amount (the part that doesn't
 * count in statistics) and flags the row `is_manual`. `0` clears
 * the exclusion; "revert to automatic" resets both category and
 * exclusion server-side.
 */
export function useSetExclusion() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { txId: number; excludedAmount: string }) =>
      apiPost<MessageOut>(
        `/api/finance/transactions/${variables.txId}/exclusion/`,
        {
          excluded_amount: variables.excludedAmount,
        } satisfies ExclusionIn,
      ),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.exclusionSaveFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}

/**
 * POST /api/finance/limits/{id}/delete/ — owner/user-scoped delete;
 * the template version was a per-row form POST + redirect.
 */
export function useDeleteLimit() {
  const { t } = useTranslation('finance');
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (limitId: number) =>
      apiPost<MessageOut>(`/api/finance/limits/${limitId}/delete/`),
    onSuccess: (data) => {
      const message = resultMessage(data);
      if (message) {
        pushToast(message, data.success ? 'success' : 'warning');
      }
    },
    onError: (error) =>
      pushToast(
        t('mutations.limitDeleteFailed', { detail: errorDetail(error) }),
        'warning',
      ),
    onSettled: () => invalidateFinance(queryClient),
  });
}
