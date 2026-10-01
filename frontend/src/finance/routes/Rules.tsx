import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
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
        title="Categorization Rules"
        subtitle={
          'Rules run top to bottom — the first matching rule assigns its ' +
          'category. Saving a rule re-categorizes your history (manual ' +
          'categories are never overwritten).'
        }
      >
        {isPending && <LoadingSkeleton label="Loading rules" rows={5} />}
        {isError && (
          <ErrorState error={error} onRetry={() => refetch()} label="rules" />
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
      title="Categories"
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
            Name
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
            Color
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
            {editingId !== null ? 'Save' : 'Add'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className="btn btn-link btn-sm"
              onClick={reset}
            >
              Cancel
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
                  title="Edit category"
                  aria-label={`Edit ${category.name}`}
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
                  title="Delete category"
                  aria-label={`Delete ${category.name}`}
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
          No categories yet — create one, then add rules that assign it.
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
  return (
    <CollapsibleCard
      id="rulesCollapse"
      title="Rules"
      count={data.rules.length}
      actions={
        <>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={data.categories.length === 0}
            onClick={onNew}
          >
            <i className="bi bi-plus-lg" /> New rule
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
            Re-apply rules
          </button>
        </>
      }
    >
      {data.rules.length > 0 ? (
        <table className="rules-table table table-hover mb-0">
          <thead>
            <tr>
              <th>#</th>
              <th>Category</th>
              <th>Matches</th>
              <th>Active</th>
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
        <EmptyState icon="diagram-3" title="No rules yet">
          Rules automatically categorize transactions during sync based on the
          sender / receiver name or the payment description.
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
          <i className="bi bi-check-circle text-success" title="Active" />
        ) : (
          <i className="bi bi-x-circle text-muted" title="Inactive" />
        )}
      </td>
      <td className="rule-cell-actions text-nowrap text-end">
        <div className="btn-group btn-group-sm">
          <button
            type="button"
            className="btn rules-ghost-btn"
            title="Edit"
            aria-label={`Edit rule ${rule.priority}`}
            onClick={onEdit}
          >
            <i className="bi bi-pencil" />
          </button>
          <button
            type="button"
            className="btn rules-ghost-btn"
            title="Move up"
            aria-label={`Move rule ${rule.priority} up`}
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
            title="Move down"
            aria-label={`Move rule ${rule.priority} down`}
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
            title="Delete"
            aria-label={`Delete rule ${rule.priority}`}
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
  const matchLabel = (value: string) =>
    (
      data.match_types.find((matchType) => matchType.value === value)?.label ??
      value
    ).toLowerCase();
  const scopeLabel = (value: string) =>
    (
      data.counterparty_scopes.find((scope) => scope.value === value)?.label ??
      value
    ).toLowerCase();

  return (
    <>
      {rule.counterparty_pattern && (
        <code>
          {scopeLabel(rule.counterparty_scope)}{' '}
          {matchLabel(rule.counterparty_match_type)} &quot;
          {rule.counterparty_pattern}&quot;
        </code>
      )}{' '}
      {rule.counterparty_pattern && rule.description_pattern && (
        <span className="badge text-bg-light">{rule.operator}</span>
      )}{' '}
      {rule.description_pattern && (
        <code>
          description {matchLabel(rule.description_match_type)} &quot;
          {rule.description_pattern}&quot;
        </code>
      )}{' '}
      {rule.description_exclusion && (
        <>
          <span className="badge text-bg-light">except</span>{' '}
          <code>
            description contains &quot;{rule.description_exclusion}&quot;
          </code>
        </>
      )}
    </>
  );
}
