/**
 * Per-row "create rule" flow shared by the transactions route and
 * the category overview's drill-down table: `ruleTx` stays non-null
 * while a rule is being drafted from that transaction. The drawer's
 * form metadata (categories, match types, scopes, operators,
 * existing rules for the priority seed) comes from the shared rules
 * query — fetched lazily on the first click, cached for the rules
 * page and later clicks.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import RuleDrawer from '../components/RuleDrawer';
import { fetchRules, type TransactionOut } from '../api';
import { errorDetail } from '../../shared/api/errors';
import { pushToast } from '../../shared/toasts';

export interface RuleDrawerState {
  /** Opens the drawer prefilled from the row's transaction. */
  openRuleDrawer: (tx: TransactionOut) => void;
  /** Transaction id whose rule form is still loading (spinner). */
  ruleLoadingId: number | null;
  /** The drawer element — render near the page root. */
  drawer: ReactNode;
}

export function useRuleDrawer(): RuleDrawerState {
  const { t } = useTranslation('finance');
  const [ruleTx, setRuleTx] = useState<TransactionOut | null>(null);
  const rulesQuery = useQuery({
    queryKey: ['finance', 'rules'],
    queryFn: fetchRules,
    enabled: ruleTx !== null,
  });
  const maxPriority = (rulesQuery.data?.rules ?? []).reduce(
    (max, rule) => Math.max(max, rule.priority),
    0,
  );
  useEffect(() => {
    if (rulesQuery.isError) {
      pushToast(
        t('transactions.ruleFormError', {
          detail: errorDetail(rulesQuery.error),
        }),
        'warning',
      );
    }
  }, [rulesQuery.isError, rulesQuery.error, t]);

  const openRuleDrawer = (tx: TransactionOut) => {
    setRuleTx(tx);
    // A failed fetch leaves the query in its error state — an
    // explicit refetch lets the next click retry it.
    if (rulesQuery.isError) rulesQuery.refetch();
  };

  return {
    openRuleDrawer,
    ruleLoadingId: rulesQuery.isPending && ruleTx ? ruleTx.id : null,
    drawer:
      ruleTx && rulesQuery.data ? (
        <RuleDrawer
          rule={null}
          data={rulesQuery.data}
          maxPriority={maxPriority}
          prefill={{
            counterparty_pattern: ruleTx.counterparty ?? '',
            description_pattern: ruleTx.remittance_information ?? '',
          }}
          onClose={() => setRuleTx(null)}
        />
      ) : null,
  };
}

export default useRuleDrawer;
