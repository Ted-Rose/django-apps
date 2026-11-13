import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  CategoryOut,
  RuleOut,
  RulePreviewIn,
  RulePreviewOut,
  RuleSaveIn,
  RulesOut,
} from '../api';
import { usePreviewRule, useSaveRule } from '../mutations';
import Dropdown from '../../shared/components/Dropdown';
import { errorDetail } from '../../shared/api/errors';
import './RuleDrawer.css';

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

const FALLBACK_COLOR = '#6c757d';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * The category color is user input — fall back to muted grey on
 * anything that is not `#rrggbb` (same guard as CategoryBadge).
 */
function categoryColor(category: CategoryOut | undefined): string {
  return category && HEX_COLOR.test(category.color)
    ? category.color
    : FALLBACK_COLOR;
}

/** Form values kept as raw input strings; converted on submit. */
export interface RuleFields {
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
  excluded_amount: string;
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
    excluded_amount: '',
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
    excluded_amount: rule.excluded_amount ?? '',
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
    excluded_amount: fields.excluded_amount.trim() || null,
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
    excluded_amount: fields.excluded_amount.trim() || null,
  };
}

/** Port of rule_sandbox.js `renderPreview`'s summary line. */
function previewSummary(t: TFunction, data: RulePreviewOut): string {
  let changeText: string;
  if (data.changes_total) {
    const parts: string[] = [];
    if (data.gains) {
      parts.push(
        t('rules.preview.gains', {
          count: data.gains,
          category: data.category,
        }),
      );
    }
    if (data.losses) {
      parts.push(t('rules.preview.losses', { count: data.losses }));
    }
    if (data.other_changes) {
      parts.push(
        t('rules.preview.otherChanges', { count: data.other_changes }),
      );
    }
    changeText =
      ' ' +
      t('rules.preview.changes', {
        count: data.changes_total,
        parts: parts.join(', '),
      });
  } else {
    changeText = ` ${t('rules.preview.noChanges')}`;
  }
  if (!data.is_active) {
    return (
      t('rules.preview.inactive', {
        count: data.match_count,
        matchCount: data.match_count,
      }) + changeText
    );
  }
  return (
    t('rules.preview.match', {
      count: data.match_count,
      matchCount: data.match_count,
      applyCount: data.apply_count,
    }) + changeText
  );
}

/**
 * Translated label for a server-sent choice value — catalog under
 * `finance:server.<group>` with the API's English label as
 * fallback. Values arrive snake/upper case (starts_with, AND);
 * catalog keys are camel/lower case.
 */
function choiceLabel(
  t: TFunction,
  group: string,
  value: string,
  fallback: string,
): string {
  const key = value
    .toLowerCase()
    .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  return t(`server:${group}.${key}`, { defaultValue: fallback });
}

/** Field values merged into the defaults of a new rule — e.g. a
 * transaction's counterparty/description (transactions page). */
export type RulePrefill = Partial<RuleFields>;

interface RuleDrawerProps {
  /** The rule being edited; `null` for a new rule. */
  rule: RuleOut | null;
  data: RulesOut;
  /** Highest priority in the current ruleset (new rules seed +1). */
  maxPriority: number;
  onClose: () => void;
  /** Seed values for a new rule; ignored when editing. */
  prefill?: RulePrefill;
}

export function RuleDrawer({
  rule,
  data,
  maxPriority,
  onClose,
  prefill,
}: RuleDrawerProps) {
  const { t } = useTranslation('finance');
  const titleId = useId();
  const [fields, setFields] = useState<RuleFields>(() =>
    rule
      ? fieldsFromRule(rule)
      : { ...defaults(data, maxPriority), ...prefill },
  );
  // The folded sections start open when they hold a non-default
  // value (editing a rule, or a new rule prefilled from a
  // transaction) so applied filters are never hidden away.
  const [openSections, setOpenSections] = useState(() => ({
    counterparty:
      fields.counterparty_pattern !== '' ||
      fields.counterparty_scope !== 'any' ||
      fields.counterparty_match_type !== 'contains',
    exclusion: fields.description_exclusion !== '',
    options:
      fields.operator !== 'AND' ||
      fields.excluded_amount !== '' ||
      !fields.is_active,
  }));
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

  // Skip no-op writes — a new `fields` object would refire the
  // debounced preview request with an identical payload.
  const set = (key: keyof RuleFields, value: string | boolean) =>
    setFields((current) =>
      current[key] === value ? current : { ...current, [key]: value },
    );

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));

  const selectedCategory = data.categories.find(
    (category) => String(category.id) === fields.category,
  );

  // Value previews shown on the folded section headers.
  const counterpartySummary =
    fields.counterparty_pattern.trim() ||
    (fields.counterparty_scope === 'any'
      ? ''
      : choiceLabel(
          t,
          'scopes',
          fields.counterparty_scope,
          data.counterparty_scopes.find(
            (scope) => scope.value === fields.counterparty_scope,
          )?.label ?? fields.counterparty_scope,
        ));
  const optionsSummary = [
    fields.operator !== 'AND'
      ? choiceLabel(t, 'operators', fields.operator, fields.operator)
      : null,
    fields.excluded_amount.trim() || null,
    fields.is_active ? null : t('rules.inactiveTitle'),
  ]
    .filter(Boolean)
    .join(' · ');

  const categoryToggleClass =
    'form-select text-start d-flex align-items-center gap-2';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The disabled Save button already blocks this; guard anyway —
    // requestSubmit() bypasses the button's disabled state.
    if (!fields.category) return;
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
            {rule
              ? t('rules.drawer.editTitle', { priority: rule.priority })
              : t('rules.drawer.newTitle')}
          </h5>
          <button
            type="button"
            className="btn-close"
            aria-label={t('common:common.close')}
            onClick={onClose}
          />
        </div>
        <div className="offcanvas-body">
          <form onSubmit={submit}>
            <div className="mb-3">
              <label className="form-label" htmlFor="rule-description">
                {t('rules.drawer.descriptionLabel')}
              </label>
              <div className="row g-2">
                <div className="col-12 col-md-4">
                  <select
                    id="rule-description-match-type"
                    className="form-select"
                    title={t('rules.drawer.matchTypeTitle')}
                    aria-label={t('rules.drawer.descriptionMatchAria')}
                    value={fields.description_match_type}
                    onChange={(event) =>
                      set('description_match_type', event.target.value)
                    }
                  >
                    {data.match_types.map((matchType) => (
                      <option key={matchType.value} value={matchType.value}>
                        {choiceLabel(
                          t,
                          'matchTypes',
                          matchType.value,
                          matchType.label,
                        )}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12 col-md-8">
                  <AutoGrowTextarea
                    id="rule-description"
                    maxLength={255}
                    className="form-control rule-autogrow"
                    placeholder={t('rules.drawer.descriptionPlaceholder')}
                    value={fields.description_pattern}
                    onChange={(event) =>
                      set('description_pattern', event.target.value)
                    }
                  />
                </div>
              </div>
            </div>
            <div className="row g-2 mb-3">
              <div className="col-12 col-md-8">
                <label className="form-label" htmlFor="rule-category">
                  {t('rules.drawer.categoryLabel')}
                </label>
                {data.categories.length === 0 ? (
                  <button
                    type="button"
                    id="rule-category"
                    className="form-select text-start"
                    disabled
                  >
                    {t('rules.drawer.noCategories')}
                  </button>
                ) : (
                  <Dropdown
                    buttonId="rule-category"
                    buttonClassName={categoryToggleClass}
                    menuClassName="w-100"
                    menuStyle={{ maxHeight: '16rem', overflowY: 'auto' }}
                    ariaLabel={`${t('rules.drawer.categoryLabel')}: ${
                      selectedCategory?.name ?? t('rules.drawer.selectCategory')
                    }`}
                    label={
                      <>
                        <span
                          className="rule-cat-dot"
                          style={{
                            backgroundColor: categoryColor(selectedCategory),
                          }}
                          aria-hidden="true"
                        />
                        <span className="rule-cat-name">
                          {selectedCategory?.name ??
                            t('rules.drawer.selectCategory')}
                        </span>
                      </>
                    }
                  >
                    {data.categories.map((category) => {
                      const isSelected =
                        String(category.id) === fields.category;
                      return (
                        <li key={category.id}>
                          <button
                            type="button"
                            className={
                              'dropdown-item d-flex ' +
                              'align-items-center gap-2' +
                              (isSelected ? ' active' : '')
                            }
                            aria-current={isSelected || undefined}
                            onClick={() => set('category', String(category.id))}
                          >
                            <span
                              className="rule-cat-dot"
                              style={{
                                backgroundColor: categoryColor(category),
                              }}
                              aria-hidden="true"
                            />
                            <span className="rule-cat-name">
                              {category.name}
                            </span>
                            {isSelected && (
                              <i
                                className="bi bi-check ms-auto"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </Dropdown>
                )}
              </div>
              <div className="col-12 col-md-4">
                <label className="form-label" htmlFor="rule-priority">
                  {t('rules.drawer.priority')}
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
            <DrawerSection
              id="rule-counterparty-section"
              label={t('rules.drawer.counterpartyName')}
              open={openSections.counterparty}
              onToggle={() => toggleSection('counterparty')}
              summary={counterpartySummary}
            >
              <label
                className="visually-hidden"
                htmlFor="rule-counterparty-pattern"
              >
                {t('rules.drawer.counterpartyName')}
              </label>
              <div className="row g-2">
                <div className="col-12 col-md-4">
                  <select
                    id="rule-counterparty-scope"
                    className="form-select"
                    title={t('rules.drawer.scopeTitle')}
                    aria-label={t('rules.drawer.scopeAria')}
                    value={fields.counterparty_scope}
                    onChange={(event) =>
                      set('counterparty_scope', event.target.value)
                    }
                  >
                    {data.counterparty_scopes.map((scope) => (
                      <option key={scope.value} value={scope.value}>
                        {choiceLabel(t, 'scopes', scope.value, scope.label)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12 col-md-3">
                  <select
                    id="rule-counterparty-match-type"
                    className="form-select"
                    title={t('rules.drawer.matchTypeTitle')}
                    aria-label={t('rules.drawer.counterpartyMatchAria')}
                    value={fields.counterparty_match_type}
                    onChange={(event) =>
                      set('counterparty_match_type', event.target.value)
                    }
                  >
                    {data.match_types.map((matchType) => (
                      <option key={matchType.value} value={matchType.value}>
                        {choiceLabel(
                          t,
                          'matchTypes',
                          matchType.value,
                          matchType.label,
                        )}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12 col-md-5">
                  <AutoGrowTextarea
                    id="rule-counterparty-pattern"
                    maxLength={255}
                    className="form-control rule-autogrow"
                    placeholder={t('rules.drawer.counterpartyPlaceholder')}
                    value={fields.counterparty_pattern}
                    onChange={(event) =>
                      set('counterparty_pattern', event.target.value)
                    }
                  />
                </div>
              </div>
            </DrawerSection>
            <DrawerSection
              id="rule-exclusion-section"
              label={t('rules.drawer.excludeLabel')}
              open={openSections.exclusion}
              onToggle={() => toggleSection('exclusion')}
              summary={fields.description_exclusion.trim()}
            >
              <label
                className="visually-hidden"
                htmlFor="rule-description-exclusion"
              >
                {t('rules.drawer.excludeLabel')}
              </label>
              <AutoGrowTextarea
                id="rule-description-exclusion"
                maxLength={255}
                className="form-control rule-autogrow"
                placeholder={t('rules.drawer.excludePlaceholder')}
                value={fields.description_exclusion}
                onChange={(event) =>
                  set('description_exclusion', event.target.value)
                }
              />
            </DrawerSection>
            <DrawerSection
              id="rule-options-section"
              label={t('rules.drawer.options')}
              open={openSections.options}
              onToggle={() => toggleSection('options')}
              summary={optionsSummary}
            >
              <div className="row g-2">
                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="rule-operator">
                    {t('rules.drawer.combine')}
                  </label>
                  <select
                    id="rule-operator"
                    className="form-select"
                    value={fields.operator}
                    onChange={(event) => set('operator', event.target.value)}
                  >
                    {data.operators.map((operator) => (
                      <option key={operator.value} value={operator.value}>
                        {choiceLabel(
                          t,
                          'operators',
                          operator.value,
                          operator.label,
                        )}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12 col-md-4">
                  <label className="form-label" htmlFor="rule-excluded-amount">
                    {t('rules.drawer.excludedAmount')}
                  </label>
                  <input
                    type="number"
                    id="rule-excluded-amount"
                    min={0}
                    step="0.01"
                    className="form-control"
                    title={t('rules.drawer.excludedAmountTitle')}
                    placeholder="0.00"
                    value={fields.excluded_amount}
                    onChange={(event) =>
                      set('excluded_amount', event.target.value)
                    }
                  />
                </div>
                <div className="col-12 col-md-4 d-flex align-items-end">
                  <div className="form-check form-switch mb-2">
                    <input
                      type="checkbox"
                      id="rule-is-active"
                      className="form-check-input"
                      role="switch"
                      checked={fields.is_active}
                      onChange={(event) =>
                        set('is_active', event.target.checked)
                      }
                    />
                    <label
                      className="form-check-label"
                      htmlFor="rule-is-active"
                    >
                      {t('rules.drawer.active')}
                    </label>
                  </div>
                </div>
              </div>
            </DrawerSection>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={save.isPending || !fields.category}
              title={
                fields.category ? undefined : t('rules.drawer.noCategories')
              }
            >
              {save.isPending && (
                <span
                  className="spinner-border spinner-border-sm me-1"
                  role="status"
                />
              )}
              {t('rules.drawer.save')}
            </button>
          </form>

          <div id="preview-panel" className="rule-preview">
            <div className="rule-section-label">
              {t('rules.drawer.impactPreview')}
            </div>
            <PreviewSummary preview={preview} />
            <div className="table-responsive">
              <table
                className="table table-sm align-middle mb-0"
                id="preview-table"
              >
                <thead>
                  <tr>
                    <th>{t('rules.drawer.colDate')}</th>
                    <th>{t('rules.drawer.colCounterparty')}</th>
                    <th>{t('rules.drawer.colDescription')}</th>
                    <th className="text-end">{t('rules.drawer.colAmount')}</th>
                    <th>{t('rules.drawer.colCategory')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.data?.changes ?? []).map((change) => (
                    <tr key={change.id}>
                      <td>{change.occurrence_date}</td>
                      <td>{change.counterparty || '-'}</td>
                      <td>{change.description || '-'}</td>
                      <td className="text-end fin-money">
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
 * Collapsible form section — a chevron toggle styled like the
 * `.rule-section-label` headers it replaces. While folded,
 * `summary` previews the current value so set filters stay
 * visible at a glance. The body uses Bootstrap's `collapse`/
 * `show` class toggle, same as shared/CollapsibleCard.
 */
function DrawerSection({
  id,
  label,
  open,
  onToggle,
  summary,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: () => void;
  summary?: string;
  children: ReactNode;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const handleToggle = () => {
    // When folding a section whose field has focus, move focus to
    // the toggle — otherwise it drops to <body>.
    if (open && bodyRef.current?.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
    onToggle();
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        ref={toggleRef}
        className="rule-section-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={handleToggle}
      >
        <i
          className={`bi ${open ? 'bi-chevron-down' : 'bi-chevron-right'}`}
          aria-hidden="true"
        />
        <span>{label}</span>
        {!open && summary && (
          <span className="rule-section-summary">{summary}</span>
        )}
      </button>
      <div id={id} ref={bodyRef} className={`collapse${open ? ' show' : ''}`}>
        {/*
          Remount children on expand: fields stay mounted while
          folded (label association, form state) but mounting under
          display:none leaves AutoGrowTextarea measured at
          scrollHeight 0 — a fresh mount while visible re-measures.
        */}
        <div key={open ? 'open' : 'closed'}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Single-line-looking textarea that grows to fit its content. A
 * text <input> can't wrap, so a long pattern would scroll out of
 * view — worst on mobile where the fields stack full-width. Height
 * is synced to scrollHeight on every value change.
 */
function AutoGrowTextarea({
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} {...props} />;
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
  const { t } = useTranslation('finance');
  let text: string;
  if (preview.isPending) {
    text = t('rules.drawer.calculating');
  } else if (preview.isError) {
    text = preview.error
      ? errorDetail(preview.error)
      : t('rules.drawer.previewUnavailable');
  } else if (preview.data) {
    text = previewSummary(t, preview.data);
  } else {
    text = t('rules.drawer.previewHint');
  }
  return (
    <div id="preview-summary" className="text-muted mb-2">
      {text}
    </div>
  );
}

export default RuleDrawer;
