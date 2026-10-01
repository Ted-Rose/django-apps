import { useEffect, useId, useState, type FormEvent } from 'react';
import type {
  RuleOut,
  RulePreviewIn,
  RulePreviewOut,
  RuleSaveIn,
  RulesOut,
} from '../api';
import { usePreviewRule, useSaveRule } from '../mutations';
import { errorDetail } from '../../shared/api/errors';

/**
 * Offcanvas rule drawer — the React port of rules.html's
 * `#rule-drawer` + `rule_sandbox.js`. The SPA shell loads Bootstrap
 * CSS but not its JS bundle, so the drawer reuses the `.offcanvas`
 * classes (whose `transform .3s ease-in-out` provides the slide)
 * toggled by React state — the same approach shared/Modal uses for
 * `.modal`.
 *
 * Every field edit schedules a debounced `POST
 * /api/finance/rules/preview/`; the response renders the
 * match/apply/change summary and the capped `changes` diff table,
 * exactly like `rule_sandbox.js`'s `renderPreview`. Saving posts
 * `/api/finance/rules/save/` (the mutation hook toasts the API's
 * `message` and invalidates the finance queries) and closes the
 * drawer.
 */

const PREVIEW_DEBOUNCE_MS = 400;

/** Form values kept as raw input strings; converted on submit. */
interface RuleFields {
  category: string;
  priority: string;
  counterparty_scope: string;
  counterparty_pattern: string;
  counterparty_match_type: string;
  description_pattern: string;
  description_match_type: string;
  description_exclusion: string;
  operator: string;
  is_active: boolean;
}

function defaults(data: RulesOut, maxPriority: number): RuleFields {
  return {
    category: data.categories[0] ? String(data.categories[0].id) : '',
    // The template JS seeded priority with max(priority) + 1.
    priority: String(maxPriority + 1),
    counterparty_scope: 'any',
    counterparty_pattern: '',
    counterparty_match_type: 'contains',
    description_pattern: '',
    description_match_type: 'contains',
    description_exclusion: '',
    operator: 'AND',
    is_active: true,
  };
}

function fieldsFromRule(rule: RuleOut): RuleFields {
  return {
    category: String(rule.category_id),
    priority: String(rule.priority),
    counterparty_scope: rule.counterparty_scope,
    counterparty_pattern: rule.counterparty_pattern,
    counterparty_match_type: rule.counterparty_match_type,
    description_pattern: rule.description_pattern,
    description_match_type: rule.description_match_type,
    description_exclusion: rule.description_exclusion,
    operator: rule.operator,
    is_active: rule.is_active,
  };
}

/**
 * The preview payload mirrors rule_sandbox.js's `payload()`
 * (category goes as `category_id`); save uses `category` per the
 * CategoryRuleForm contract. `is_active` is sent as a JSON boolean
 * both ways — the plan's checkbox-semantics gotcha confirms an
 * explicit false is handled correctly.
 */
function previewPayload(fields: RuleFields, ruleId?: number): RulePreviewIn {
  return {
    rule_id: ruleId ?? null,
    category_id: fields.category ? Number(fields.category) : null,
    priority: Number(fields.priority) || 1,
    counterparty_scope: fields.counterparty_scope,
    counterparty_pattern: fields.counterparty_pattern,
    counterparty_match_type: fields.counterparty_match_type,
    description_pattern: fields.description_pattern,
    description_match_type: fields.description_match_type,
    description_exclusion: fields.description_exclusion,
    operator: fields.operator,
    is_active: fields.is_active,
  };
}

function savePayload(fields: RuleFields, ruleId?: number): RuleSaveIn {
  return {
    rule_id: ruleId ?? null,
    category: fields.category ? Number(fields.category) : null,
    priority: Number(fields.priority) || 1,
    counterparty_scope: fields.counterparty_scope,
    counterparty_pattern: fields.counterparty_pattern,
    counterparty_match_type: fields.counterparty_match_type,
    description_pattern: fields.description_pattern,
    description_match_type: fields.description_match_type,
    description_exclusion: fields.description_exclusion,
    operator: fields.operator,
    is_active: fields.is_active,
  };
}

/** Port of rule_sandbox.js `renderPreview`'s summary line. */
function previewSummary(data: RulePreviewOut): string {
  let changeText: string;
  if (data.changes_total) {
    const parts: string[] = [];
    if (data.gains) parts.push(`${data.gains} gaining "${data.category}"`);
    if (data.losses) parts.push(`${data.losses} losing it`);
    if (data.other_changes) parts.push(`${data.other_changes} other`);
    changeText = ` ${data.changes_total} would change category (${parts.join(', ')}).`;
  } else {
    changeText = ' No categories would change.';
  }
  if (!data.is_active) {
    return (
      'Rule is inactive — it will not categorize anything until ' +
      `activated. ${data.match_count} transaction(s) would match ` +
      `its patterns.${changeText}`
    );
  }
  return (
    `${data.match_count} transaction(s) match, rule would apply ` +
    `to ${data.apply_count}.${changeText}`
  );
}

interface RuleDrawerProps {
  /** The rule being edited; `null` for a new rule. */
  rule: RuleOut | null;
  data: RulesOut;
  /** Highest priority in the current ruleset (new rules seed +1). */
  maxPriority: number;
  onClose: () => void;
}

export function RuleDrawer({
  rule,
  data,
  maxPriority,
  onClose,
}: RuleDrawerProps) {
  const titleId = useId();
  const [fields, setFields] = useState<RuleFields>(() =>
    rule ? fieldsFromRule(rule) : defaults(data, maxPriority),
  );
  // Slide-in: `.offcanvas` starts translated off-screen; `.show`
  // is applied on the next frame so the CSS transition runs.
  const [shown, setShown] = useState(false);
  const save = useSaveRule();
  const preview = usePreviewRule();
  const previewMutate = preview.mutate;
  const ruleId = rule?.id;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Debounced sandbox preview — fires once on open (like the JS
  // schedulePreview calls in the new/edit handlers) and again after
  // every field change.
  useEffect(() => {
    const timer = setTimeout(
      () => previewMutate(previewPayload(fields, ruleId)),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [fields, ruleId, previewMutate]);

  const set = (key: keyof RuleFields, value: string | boolean) =>
    setFields((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(savePayload(fields, ruleId), {
      onSuccess: (result) => {
        if (result?.success) onClose();
      },
    });
  };

  return (
    <>
      <div
        className={`offcanvas offcanvas-end${shown ? ' show' : ''}`}
        style={{ width: 640 }}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="rule-drawer"
      >
        <div className="offcanvas-header">
          <h5 className="offcanvas-title" id={titleId}>
            {rule ? `Edit rule #${rule.priority}` : 'New rule'}
          </h5>
          <button
            type="button"
            className="btn-close"
            aria-label="Close"
            onClick={onClose}
          />
        </div>
        <div className="offcanvas-body">
          <form onSubmit={submit}>
            <div className="row g-2 mb-3">
              <div className="col-8">
                <label className="form-label" htmlFor="rule-category">
                  Category
                </label>
                <select
                  id="rule-category"
                  className="form-select"
                  required
                  value={fields.category}
                  onChange={(event) => set('category', event.target.value)}
                >
                  {fields.category === '' && (
                    <option value="" disabled>
                      No categories yet
                    </option>
                  )}
                  {data.categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-4">
                <label className="form-label" htmlFor="rule-priority">
                  Priority
                </label>
                <input
                  type="number"
                  id="rule-priority"
                  min={1}
                  className="form-control"
                  required
                  value={fields.priority}
                  onChange={(event) => set('priority', event.target.value)}
                />
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label" htmlFor="rule-counterparty-pattern">
                Counterparty name
              </label>
              <div className="row g-2">
                <div className="col-4">
                  <select
                    id="rule-counterparty-scope"
                    className="form-select"
                    title="Which name field to match"
                    aria-label="Counterparty scope"
                    value={fields.counterparty_scope}
                    onChange={(event) =>
                      set('counterparty_scope', event.target.value)
                    }
                  >
                    {data.counterparty_scopes.map((scope) => (
                      <option key={scope.value} value={scope.value}>
                        {scope.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-3">
                  <select
                    id="rule-counterparty-match-type"
                    className="form-select"
                    title="Match type"
                    aria-label="Counterparty match type"
                    value={fields.counterparty_match_type}
                    onChange={(event) =>
                      set('counterparty_match_type', event.target.value)
                    }
                  >
                    {data.match_types.map((matchType) => (
                      <option key={matchType.value} value={matchType.value}>
                        {matchType.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-5">
                  <input
                    type="text"
                    id="rule-counterparty-pattern"
                    maxLength={255}
                    className="form-control"
                    placeholder="e.g. Rimi, employer name"
                    value={fields.counterparty_pattern}
                    onChange={(event) =>
                      set('counterparty_pattern', event.target.value)
                    }
                  />
                </div>
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label" htmlFor="rule-description">
                Description
              </label>
              <div className="row g-2">
                <div className="col-4">
                  <select
                    id="rule-description-match-type"
                    className="form-select"
                    title="Match type"
                    aria-label="Description match type"
                    value={fields.description_match_type}
                    onChange={(event) =>
                      set('description_match_type', event.target.value)
                    }
                  >
                    {data.match_types.map((matchType) => (
                      <option key={matchType.value} value={matchType.value}>
                        {matchType.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-8">
                  <input
                    type="text"
                    id="rule-description"
                    maxLength={255}
                    className="form-control"
                    placeholder="e.g. grocery purchase"
                    value={fields.description_pattern}
                    onChange={(event) =>
                      set('description_pattern', event.target.value)
                    }
                  />
                </div>
              </div>
            </div>
            <div className="mb-3">
              <label
                className="form-label"
                htmlFor="rule-description-exclusion"
              >
                Exclude when description contains
              </label>
              <input
                type="text"
                id="rule-description-exclusion"
                maxLength={255}
                className="form-control"
                placeholder="e.g. refund — rule never applies"
                value={fields.description_exclusion}
                onChange={(event) =>
                  set('description_exclusion', event.target.value)
                }
              />
            </div>
            <div className="row g-2 mb-3">
              <div className="col-4">
                <label className="form-label" htmlFor="rule-operator">
                  Patterns combine
                </label>
                <select
                  id="rule-operator"
                  className="form-select"
                  value={fields.operator}
                  onChange={(event) => set('operator', event.target.value)}
                >
                  {data.operators.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-4 d-flex align-items-end">
                <div className="form-check mb-2">
                  <input
                    type="checkbox"
                    id="rule-is-active"
                    className="form-check-input"
                    checked={fields.is_active}
                    onChange={(event) => set('is_active', event.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="rule-is-active">
                    Active
                  </label>
                </div>
              </div>
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={save.isPending}
            >
              {save.isPending && (
                <span
                  className="spinner-border spinner-border-sm me-1"
                  role="status"
                />
              )}
              Save rule
            </button>
          </form>

          <hr className="my-4" />

          <div id="preview-panel">
            <h6>Impact preview</h6>
            <PreviewSummary preview={preview} />
            <div className="table-responsive">
              <table className="table table-sm" id="preview-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Counterparty</th>
                    <th>Description</th>
                    <th className="text-end">Amount</th>
                    <th>Category</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.data?.changes ?? []).map((change) => (
                    <tr key={change.id}>
                      <td>{change.booking_date}</td>
                      <td>{change.counterparty || '-'}</td>
                      <td>{change.description || '-'}</td>
                      <td className="text-end">
                        {change.amount} {change.currency}
                      </td>
                      <td>
                        {change.old_category || '—'} →{' '}
                        {change.new_category || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div className="offcanvas-backdrop fade show" onClick={onClose} />
    </>
  );
}

/**
 * The preview summary line — idle hint, "Calculating impact…" while
 * the debounced request is in flight, the API error detail on
 * failure (rule_sandbox.js rendered `data.error` here), or the
 * match/apply/change counts from the response.
 */
function PreviewSummary({
  preview,
}: {
  preview: {
    data?: RulePreviewOut;
    isPending: boolean;
    isError: boolean;
    error: unknown;
  };
}) {
  let text: string;
  if (preview.isPending) {
    text = 'Calculating impact...';
  } else if (preview.isError) {
    text = preview.error ? errorDetail(preview.error) : 'Preview unavailable.';
  } else if (preview.data) {
    text = previewSummary(preview.data);
  } else {
    text =
      'Edit the rule to preview how it would categorize your transactions.';
  }
  return (
    <div id="preview-summary" className="text-muted mb-2">
      {text}
    </div>
  );
}

export default RuleDrawer;
