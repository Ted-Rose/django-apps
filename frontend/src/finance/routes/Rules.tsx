import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import PageShell from '../components/PageShell';
import CategoryBadge from '../components/CategoryBadge';
import RuleDrawer from '../components/RuleDrawer';
import Toasts from '../../shared/components/Toasts';
import './rules.css';
import {
  fetchRules,
  type CategoryOut,
  type RuleOut,
  type RulesOut,
} from '../api';
import {
  useApplyRules,
  useDeleteCategory,
  useDeleteRule,
  useMoveRule,
  useSaveCategory,
} from '../mutations';

/**
 * React port of rules.html — a collapsible categories card (name +
 * color form, per-category edit/delete; delete re-applies rules
 * server-side) and a collapsible rules card holding the prioritized
 * rules table with edit/move/delete actions, a "Re-apply rules"
 * button, and the RuleDrawer sandbox (offcanvas form + debounced
 * preview, ported from rule_sandbox.js).
 *
 * Both sections are CollapsibleCards (the `collapse`/`show` + chevron
 * pattern from tasks' CompletedSection); categories start collapsed
 * on narrow screens so the rules are first. Below md the rules table
 * collapses into cards via the `.rules-table` rules in finance.css
 * (same approach as `.tx-table` on the transactions page).
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
      <PageShell
        title={t('rules.title')}
        subtitle={t('rules.subtitle')}
      >
        {isPending && (
          <LoadingSkeleton label={t('rules.loading')} rows={5} />
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label={t('rules.loadLabel')}
          />
        )}
        {data && (
          <div className="row g-3">
            <div className="col-12 col-md-4">
              <CategoriesCard categories={data.categories} />
            </div>
            <div className="col-12 col-md-8">
              <RulesCard
                data={data}
                applying={applyRules.isPending}
                onApply={() => applyRules.mutate()}
                onNew={() => setDrawer({ rule: null })}
                onEdit={(rule) => setDrawer({ rule })}
              />
            </div>
          </div>
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
 * Card with a clickable header (title + count badge + chevron) that
 * expands/collapses the body — the `collapse`/`show` class toggle
 * from tasks' CompletedSection. `actions` render right-aligned in
 * the header so they stay reachable while the body is collapsed.
 */
function CollapsibleCard({
  id,
  title,
  count,
  actions,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card fin-card rules-collapsible">
      <div className="card-header d-flex flex-wrap align-items-center gap-2">
        <button
          type="button"
          className="btn btn-link link-body-emphasis text-decoration-none p-0 d-flex align-items-center gap-2"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((prev) => !prev)}
        >
          <i
            className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`}
          />
          <span className="fw-semibold">{title}</span>
          {count !== undefined && (
            <span className="badge rounded-pill text-bg-light border">
              {count}
            </span>
          )}
        </button>
        {actions && (
          <div className="ms-auto d-flex flex-wrap gap-2">{actions}</div>
        )}
      </div>
      <div id={id} className={`collapse${open ? ' show' : ''}`}>
        <div className="card-body">{children}</div>
      </div>
    </div>
  );
}

/** Narrow screens start with categories collapsed — rules are the
 *  primary content. jsdom has no matchMedia, so fall back to open. */
const isNarrowScreen = () =>
  typeof window.matchMedia === 'function' &&
  !window.matchMedia('(min-width: 768px)').matches;

/**
 * The categories card: name + color create/edit form (the API
 * update_or_creates on (user, name), so "edit" just refills the
 * form) and the category list with edit/delete actions.
 */
function CategoriesCard({ categories }: { categories: CategoryOut[] }) {
  const { t } = useTranslation('finance');
  const saveCategory = useSaveCategory();
  const deleteCategory = useDeleteCategory();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6c757d');
  const [editingId, setEditingId] = useState<number | null>(null);

  const reset = () => {
    setName('');
    setColor('#6c757d');
    setEditingId(null);
  };

  return (
    <CollapsibleCard
      id="categoriesCollapse"
      title={t('rules.categoriesTitle')}
      count={categories.length}
      defaultOpen={!isNarrowScreen()}
    >
      <form
        className="row g-2 align-items-end mb-3"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          saveCategory.mutate(
            { name: trimmed, color },
            { onSuccess: (result) => result?.success && reset() },
          );
        }}
      >
        <div className="col-6">
          <label className="form-label" htmlFor="cat-name">
            {t('rules.nameLabel')}
          </label>
          <input
            type="text"
            id="cat-name"
            maxLength={100}
            className="form-control"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="col-3">
          <label className="form-label" htmlFor="cat-color">
            {t('rules.colorLabel')}
          </label>
          <input
            type="color"
            id="cat-color"
            className="form-control form-control-color"
            value={color}
            onChange={(event) => setColor(event.target.value)}
          />
        </div>
        <div className="col-3 d-flex gap-1">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveCategory.isPending}
          >
            {editingId !== null
              ? t('common:common.save')
              : t('common:common.add')}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="btn btn-link btn-sm"
              onClick={reset}
            >
              {t('common:common.cancel')}
            </button>
          )}
        </div>
      </form>
      {categories.length > 0 ? (
        <ul className="cat-list list-unstyled mb-0">
          {categories.map((category) => (
            <li
              key={category.id}
              className="cat-row d-flex justify-content-between align-items-center py-2"
            >
              <CategoryBadge category={category} />
              <span className="d-flex gap-1">
                <button
                  type="button"
                  className="btn btn-sm rules-ghost-btn"
                  title={t('rules.editCategory')}
                  aria-label={t('rules.editCategoryAria', {
                    name: category.name,
                  })}
                  onClick={() => {
                    setName(category.name);
                    setColor(category.color || '#6c757d');
                    setEditingId(category.id);
                  }}
                >
                  <i className="bi bi-pencil" />
                </button>
                <button
                  type="button"
                  className="btn btn-sm rules-ghost-btn rules-ghost-danger"
                  title={t('rules.deleteCategory')}
                  aria-label={t('rules.deleteCategoryAria', {
                    name: category.name,
                  })}
                  disabled={deleteCategory.isPending}
                  onClick={() => deleteCategory.mutate(category.id)}
                >
                  <i className="bi bi-trash" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted small mb-0">
          {t('rules.emptyCategories')}
        </p>
      )}
    </CollapsibleCard>
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
            className="btn rules-ghost-btn"
            title={t('common:common.edit')}
            aria-label={t('rules.editAria', { priority: rule.priority })}
            onClick={onEdit}
          >
            <i className="bi bi-pencil" />
          </button>
          <button
            type="button"
            className="btn rules-ghost-btn"
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
            className="btn rules-ghost-btn"
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
            className="btn rules-ghost-btn rules-ghost-danger"
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
    value.toLowerCase().replace(/_([a-z])/g, (_, c: string) =>
      c.toUpperCase(),
    );
  const matchLabel = (value: string) =>
    t(`server:matchTypes.${catalogKey(value)}`, {
      defaultValue:
        data.match_types.find((m) => m.value === value)?.label ?? value,
    }).toLowerCase();
  const scopeLabel = (value: string) =>
    t(`server:scopes.${catalogKey(value)}`, {
      defaultValue:
        data.counterparty_scopes.find((s) => s.value === value)?.label ??
        value,
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
