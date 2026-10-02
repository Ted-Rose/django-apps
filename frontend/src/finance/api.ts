import { apiGet } from '../shared/api/client';
import type { components } from './api-types';

/** Type aliases over the generated OpenAPI schemas (api-types.ts). */
export type AccountsOut = components['schemas']['AccountsOut'];
export type AccountOut = components['schemas']['AccountOut'];
export type InstitutionsOut = components['schemas']['InstitutionsOut'];
export type InstitutionOut = components['schemas']['InstitutionOut'];
export type TransactionsOut = components['schemas']['TransactionsOut'];
export type TransactionOut = components['schemas']['TransactionOut'];
export type CategoryOverviewOut = components['schemas']['CategoryOverviewOut'];
export type CategoryRowOut = components['schemas']['CategoryRowOut'];
export type CurrencyTotalOut = components['schemas']['CurrencyTotalOut'];
export type PeriodOut = components['schemas']['PeriodOut'];
export type LimitsOut = components['schemas']['LimitsOut'];
export type LimitOut = components['schemas']['LimitOut'];
export type WindowStatOut = components['schemas']['WindowStatOut'];
export type BalancesOut = components['schemas']['BalancesOut'];
export type RulesOut = components['schemas']['RulesOut'];
export type RuleOut = components['schemas']['RuleOut'];
export type CategoryOut = components['schemas']['CategoryOut'];
export type AccountOptionOut = components['schemas']['AccountOptionOut'];
export type ChoiceOut = components['schemas']['ChoiceOut'];
export type NotificationOut = components['schemas']['NotificationOut'];
export type NotificationsOut = components['schemas']['NotificationsOut'];

/** Mutation request/response bodies (POST /api/finance/…). */
export type ConnectIn = components['schemas']['ConnectIn'];
export type ConnectOut = components['schemas']['ConnectOut'];
export type ShareIn = components['schemas']['ShareIn'];
export type SyncIn = components['schemas']['SyncIn'];
export type SyncOut = components['schemas']['SyncOut'];
export type SyncAccountOut = components['schemas']['SyncAccountOut'];
export type RefreshOut = components['schemas']['RefreshOut'];
export type LimitSaveIn = components['schemas']['LimitSaveIn'];
export type RuleSaveIn = components['schemas']['RuleSaveIn'];
export type MoveRuleIn = components['schemas']['MoveRuleIn'];
export type RulePreviewIn = components['schemas']['RulePreviewIn'];
export type RulePreviewOut = components['schemas']['RulePreviewOut'];
export type RulePreviewChangeOut =
  components['schemas']['RulePreviewChangeOut'];
export type RulesChangedOut = components['schemas']['RulesChangedOut'];
export type CategorySaveIn = components['schemas']['CategorySaveIn'];
export type PushConfigOut = components['schemas']['PushConfigOut'];
export type PushSubscribeIn = components['schemas']['PushSubscribeIn'];
export type PushUnsubscribeIn = components['schemas']['PushUnsubscribeIn'];
export type BalanceAlertSaveIn =
  components['schemas']['BalanceAlertSaveIn'];
export type NotificationsReadIn =
  components['schemas']['NotificationsReadIn'];
export type MessageOut = components['schemas']['MessageOut'];
export type SuccessOut = components['schemas']['SuccessOut'];
export type ToggleBalanceCheckOut =
  components['schemas']['ToggleBalanceCheckOut'];

/** GET /api/finance/accounts/ → AccountsOut. */
export function fetchAccounts(): Promise<AccountsOut> {
  return apiGet<AccountsOut>('/api/finance/accounts/');
}

/** GET /api/finance/institutions/?country= → InstitutionsOut. */
export function fetchInstitutions(country = ''): Promise<InstitutionsOut> {
  const qs = new URLSearchParams();
  if (country) qs.set('country', country);
  const suffix = qs.toString();
  return apiGet<InstitutionsOut>(
    `/api/finance/institutions/${suffix ? `?${suffix}` : ''}`,
  );
}

export interface TransactionParams {
  account?: number | string | null;
  category?: string | null;
  creditor?: string | null;
  q?: string | null;
  sort?: string | null;
  direction?: string | null;
  page?: number | string | null;
}

/**
 * GET /api/finance/transactions/ — one page plus every
 * filter-dropdown option list (accounts, categories,
 * counterparties) per the rewrite plan's single-endpoint rule.
 */
export function fetchTransactions(
  params: TransactionParams = {},
): Promise<TransactionsOut> {
  const qs = new URLSearchParams();
  if (params.account != null) qs.set('account', String(params.account));
  if (params.category) qs.set('category', params.category);
  if (params.creditor) qs.set('creditor', params.creditor);
  if (params.q) qs.set('q', params.q);
  if (params.sort) qs.set('sort', params.sort);
  if (params.direction) qs.set('direction', params.direction);
  if (params.page != null) qs.set('page', String(params.page));
  const suffix = qs.toString();
  return apiGet<TransactionsOut>(
    `/api/finance/transactions/${suffix ? `?${suffix}` : ''}`,
  );
}

export interface CategoryOverviewParams {
  /** ISO dates; `from` maps to the ?from= query alias. */
  from?: string | null;
  to?: string | null;
  account?: number | string | null;
}

/** GET /api/finance/categories/overview/?from=&to=&account= */
export function fetchCategoryOverview(
  params: CategoryOverviewParams = {},
): Promise<CategoryOverviewOut> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.account != null) qs.set('account', String(params.account));
  const suffix = qs.toString();
  return apiGet<CategoryOverviewOut>(
    `/api/finance/categories/overview/${suffix ? `?${suffix}` : ''}`,
  );
}

/**
 * GET /api/finance/limits/?month=YYYY-MM — `month` re-evaluates
 * every window as of that month's last day (the template's
 * overview-month dropdown).
 */
export function fetchLimits(month?: string | null): Promise<LimitsOut> {
  const qs = new URLSearchParams();
  if (month) qs.set('month', month);
  const suffix = qs.toString();
  return apiGet<LimitsOut>(`/api/finance/limits/${suffix ? `?${suffix}` : ''}`);
}

/** GET /api/finance/balances/ → BalancesOut. */
export function fetchBalances(): Promise<BalancesOut> {
  return apiGet<BalancesOut>('/api/finance/balances/');
}

/** GET /api/finance/rules/ → RulesOut (rules + form choices). */
export function fetchRules(): Promise<RulesOut> {
  return apiGet<RulesOut>('/api/finance/rules/');
}

/**
 * GET /api/finance/notifications/ — unread in-app alerts; the SPA
 * drains them into toasts then marks them read.
 */
export function fetchNotifications(): Promise<NotificationsOut> {
  return apiGet<NotificationsOut>('/api/finance/notifications/');
}
