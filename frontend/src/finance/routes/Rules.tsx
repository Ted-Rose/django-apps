import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageShell from '../components/PageShell';
import CategoryBadge from '../components/CategoryBadge';
import CollapsibleCard from '../components/CollapsibleCard';
import RuleDrawer from '../components/RuleDrawer';
import Toasts from '../../shared/components/Toasts';
import './rules.css';
import { fetchRules, type RuleOut, type RulesOut } from '../api';
import { useApplyRules, useDeleteRule, useMoveRule } from '../mutations';

/**
 * React port of rules.html — a collapsible rules card holding the
 * prioritized rules table with edit/move/delete actions, a
 * "Re-apply rules" button, and the RuleDrawer sandbox (offcanvas
 * form + debounced preview, ported from rule_sandbox.js). Category
 * management moved to the categories page (CategoriesCard); this
 * payload still carries the category list because rules reference
 * categories by id.
 *
 * Below md the rules table collapses into cards via the
 * `.rules-table` rules in finance.css (same approach as `.tx-table`
 * on the transactions page).
 *
 * Condition summaries mirror the template: lowercased choice labels
 * for the counterparty scope/match type, the `operator` badge when
 * both patterns are set, and the "except" badge for
 * `description_exclusion`.
 */
export default function Rules() {
  const { t } = useTranslation('finance');
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'rules'],
    queryFn: fetchRules,
  });
  const applyRules = useApplyRules();
  // `null` = drawer closed; `{rule: null}` = new rule; `{rule}` = edit.
  const [drawer, setDrawer] = useState<{ rule: RuleOut | null } | null>(null);

  const maxPriority = (data?.rules ?? []).reduce(
    (max, rule) => Math.max(max, rule.priority),
    0,
  );

  return (
    <>
      <FinanceNavBar />
      <PageShell title={t('rules.title')} subtitle={t('rules.subtitle')}>
        {isPending && <LoadingSkeleton label={t('rules.loading')} rows={5} />}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label={t('rules.loadLabel')}
          />
        )}
        {data && (
          <RulesCard
            data={data}
            applying={applyRules.isPending}
            onApply={() => applyRules.mutate()}
            onNew={() => setDrawer({ rule: null })}
            onEdit={(rule) => setDrawer({ rule })}
          />
        )}
      </PageShell>
      {drawer && data && (
        <RuleDrawer
          rule={drawer.rule}
          data={data}
          maxPriority={maxPriority}
          onClose={() => setDrawer(null)}
        />
      )}
      <Toasts />
    </>
  );
}

/**
 * The rules card: "New rule" + "Re-apply rules" live in the header
 * (always reachable, even collapsed); the body holds the prioritized
 * table which collapses into per-rule cards below md.
 */
function RulesCard({
  data,
  applying,
  onApply,
  onNew,
  onEdit,
}: {
  data: RulesOut;
  applying: boolean;
  onApply: () => void;
  onNew: () => void;
  onEdit: (rule: RuleOut) => void;
}) {
  const { t } = useTranslation('finance');
  return (
    <CollapsibleCard
      id="rulesCollapse"
      title={t('rules.rulesTitle')}
      count={data.rules.length}
      actions={
        <>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={data.categories.length === 0}
            onClick={onNew}
          >
            <i className="bi bi-plus-lg" /> {t('rules.newRule')}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline-primary"
            disabled={applying}
            onClick={onApply}
          >
            {applying ? (
              <span
                className="spinner-border spinner-border-sm"
                role="status"
              />
            ) : (
              <i className="bi bi-arrow-repeat" />
            )}{' '}
            {t('rules.reapply')}
          </button>
        </>
      }
    >
      {data.rules.length > 0 ? (
        <table className="rules-table table table-hover mb-0">
          <thead>
            <tr>
              <th>{t('rules.colPriority')}</th>
              <th>{t('rules.colCategory')}</th>
              <th>{t('rules.colMatches')}</th>
              <th>{t('rules.colActive')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule, index) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                data={data}
                isFirst={index === 0}
                isLast={index === data.rules.length - 1}
                onEdit={() => onEdit(rule)}
              />
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState icon="diagram-3" title={t('rules.emptyTitle')}>
          {t('rules.emptyBody')}
          {data.categories.length === 0 && (
            <div className="mt-2">
              <Trans
                i18nKey="rules.noCategoriesYet"
                ns="finance"
                components={{ lnk: <Link to="/categories" /> }}
              />
            </div>
          )}
        </EmptyState>
      )}
    </CollapsibleCard>
  );
}

/** One row of the prioritized rules table. */
function RuleRow({
  rule,
  data,
  isFirst,
  isLast,
  onEdit,
}: {
  rule: RuleOut;
  data: RulesOut;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation('finance');
  const moveRule = useMoveRule();
  const deleteRule = useDeleteRule();
  const category = data.categories.find(
    (candidate) => candidate.id === rule.category_id,
  );

  return (
    <tr>
      <td className="rule-cell-priority">{rule.priority}</td>
      <td className="rule-cell-category">
        {category ? (
          <CategoryBadge category={category} />
        ) : (
          <span className="badge text-bg-secondary">#{rule.category_id}</span>
        )}
      </td>
      <td className="rule-cell-matches">
        <ConditionSummary rule={rule} data={data} />
      </td>
      <td className="rule-cell-active">
        {rule.is_active ? (
          <i
            className="bi bi-check-circle text-success"
            title={t('rules.activeTitle')}
          />
        ) : (
          <i
            className="bi bi-x-circle text-muted"
            title={t('rules.inactiveTitle')}
          />
        )}
      </td>
      <td className="rule-cell-actions text-nowrap text-end">
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn fin-ghost-btn"
            title={t('common:common.edit')}
            aria-label={t('rules.editAria', { priority: rule.priority })}
            onClick={onEdit}
          >
            <i className="bi bi-pencil" />
          </button>
          <button
            type="button"
            className="btn fin-ghost-btn"
            title={t('rules.moveUp')}
            aria-label={t('rules.moveUpAria', { priority: rule.priority })}
            disabled={isFirst || moveRule.isPending}
            onClick={() =>
              moveRule.mutate({ ruleId: rule.id, direction: 'up' })
            }
          >
            <i className="bi bi-arrow-up" />
          </button>
          <button
            type="button"
            className="btn fin-ghost-btn"
            title={t('rules.moveDown')}
            aria-label={t('rules.moveDownAria', {
              priority: rule.priority,
            })}
            disabled={isLast || moveRule.isPending}
            onClick={() =>
              moveRule.mutate({ ruleId: rule.id, direction: 'down' })
            }
          >
            <i className="bi bi-arrow-down" />
          </button>
          <button
            type="button"
            className="btn fin-ghost-btn fin-ghost-danger"
            title={t('common:common.delete')}
            aria-label={t('rules.deleteAria', {
              priority: rule.priority,
            })}
            disabled={deleteRule.isPending}
            onClick={() => deleteRule.mutate(rule.id)}
          >
            <i className="bi bi-trash" />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * The human-readable condition summary — mirrors the Matches cell
 * in rules.html: lowercased scope/match-type labels around the
 * quoted pattern, the operator badge between the two patterns, and
 * the "except" badge for the description exclusion.
 */
function ConditionSummary({ rule, data }: { rule: RuleOut; data: RulesOut }) {
  const { t } = useTranslation('finance');
  // Server values are snake/upper case (starts_with, AND); catalog
  // keys are camel/lower case (startsWith, and).
  const catalogKey = (value: string) =>
    value.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const matchLabel = (value: string) =>
    t(`server:matchTypes.${catalogKey(value)}`, {
      defaultValue:
        data.match_types.find((m) => m.value === value)?.label ?? value,
    }).toLowerCase();
  const scopeLabel = (value: string) =>
    t(`server:scopes.${catalogKey(value)}`, {
      defaultValue:
        data.counterparty_scopes.find((s) => s.value === value)?.label ?? value,
    }).toLowerCase();

  return (
    <>
      {rule.counterparty_pattern && (
        <code>
          {t('rules.summaryCounterparty', {
            scope: scopeLabel(rule.counterparty_scope),
            match: matchLabel(rule.counterparty_match_type),
            pattern: rule.counterparty_pattern,
          })}
        </code>
      )}{' '}
      {rule.counterparty_pattern && rule.description_pattern && (
        <span className="badge text-bg-light">
          {t(`server:operators.${catalogKey(rule.operator)}`, {
            defaultValue: rule.operator,
          })}
        </span>
      )}{' '}
      {rule.description_pattern && (
        <code>
          {t('rules.summaryDescription', {
            match: matchLabel(rule.description_match_type),
            pattern: rule.description_pattern,
          })}
        </code>
      )}{' '}
      {rule.description_exclusion && (
        <>
          <span className="badge text-bg-light">
            {t('rules.summaryExcept')}
          </span>{' '}
          <code>
            {t('rules.summaryExclusion', {
              pattern: rule.description_exclusion,
            })}
          </code>
        </>
      )}
    </>
  );
}
