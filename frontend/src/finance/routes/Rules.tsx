import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import CategoryBadge from '../components/CategoryBadge';
import RuleDrawer from '../components/RuleDrawer';
import Toasts from '../../shared/components/Toasts';
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
 * React port of rules.html — a categories card (name + color form,
 * per-category edit/delete; delete re-applies rules server-side)
 * and the prioritized rules table with edit/move/delete actions,
 * a "Re-apply rules" button, and the RuleDrawer sandbox (offcanvas
 * form + debounced preview, ported from rule_sandbox.js).
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
      <div className="container-fluid px-2 py-4">
        <h1 className="mb-2">Categorization Rules</h1>
        <p className="text-muted">
          Rules run top to bottom — the first matching rule assigns its
          category. Saving a rule re-categorizes your history (manual categories
          are never overwritten).
        </p>

        {isPending && (
          <div
            className="text-center py-5"
            aria-busy="true"
            aria-label="Loading rules"
          >
            <div className="spinner-border" role="status" />
          </div>
        )}
        {isError && (
          <ErrorState error={error} onRetry={() => refetch()} label="rules" />
        )}
        {data && (
          <div className="row g-3">
            <div className="col-md-4">
              <CategoriesCard categories={data.categories} />
            </div>
            <div className="col-md-8">
              <div className="d-flex gap-2 mb-3">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={data.categories.length === 0}
                  onClick={() => setDrawer({ rule: null })}
                >
                  <i className="bi bi-plus-lg" /> New rule
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  disabled={applyRules.isPending}
                  onClick={() => applyRules.mutate()}
                >
                  {applyRules.isPending ? (
                    <span
                      className="spinner-border spinner-border-sm"
                      role="status"
                    />
                  ) : (
                    <i className="bi bi-arrow-repeat" />
                  )}{' '}
                  Re-apply rules
                </button>
              </div>

              {data.rules.length > 0 ? (
                <div className="table-responsive">
                  <table className="table table-striped table-hover">
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
                          onEdit={() => setDrawer({ rule })}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="alert alert-info">
                  No rules yet. Rules automatically categorize transactions
                  during sync based on the sender / receiver name or the payment
                  description.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
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
    <div className="card mb-3">
      <div className="card-body">
        <h5 className="card-title">Categories</h5>
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
          <ul className="list-group">
            {categories.map((category) => (
              <li
                key={category.id}
                className="list-group-item d-flex justify-content-between align-items-center py-1"
              >
                <span>
                  <CategoryBadge category={category} />
                </span>
                <span className="d-flex gap-1">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary"
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
                    className="btn btn-sm btn-outline-danger"
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
          <div className="alert alert-info mb-0">
            No categories yet — create one, then add rules that assign it.
          </div>
        )}
      </div>
    </div>
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
      <td>{rule.priority}</td>
      <td>
        {category ? (
          <CategoryBadge category={category} />
        ) : (
          <span className="badge text-bg-secondary">#{rule.category_id}</span>
        )}
      </td>
      <td>
        <ConditionSummary rule={rule} data={data} />
      </td>
      <td>
        {rule.is_active ? (
          <i className="bi bi-check-circle text-success" />
        ) : (
          <i className="bi bi-x-circle text-muted" />
        )}
      </td>
      <td className="text-nowrap text-end">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          title="Edit"
          aria-label={`Edit rule ${rule.priority}`}
          onClick={onEdit}
        >
          <i className="bi bi-pencil" />
        </button>{' '}
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          title="Move up"
          aria-label={`Move rule ${rule.priority} up`}
          disabled={isFirst || moveRule.isPending}
          onClick={() => moveRule.mutate({ ruleId: rule.id, direction: 'up' })}
        >
          <i className="bi bi-arrow-up" />
        </button>{' '}
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          title="Move down"
          aria-label={`Move rule ${rule.priority} down`}
          disabled={isLast || moveRule.isPending}
          onClick={() =>
            moveRule.mutate({ ruleId: rule.id, direction: 'down' })
          }
        >
          <i className="bi bi-arrow-down" />
        </button>{' '}
        <button
          type="button"
          className="btn btn-sm btn-outline-danger"
          title="Delete"
          aria-label={`Delete rule ${rule.priority}`}
          disabled={deleteRule.isPending}
          onClick={() => deleteRule.mutate(rule.id)}
        >
          <i className="bi bi-trash" />
        </button>
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
