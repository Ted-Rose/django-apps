import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import EmptyState from '../components/EmptyState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import ErrorState from '../components/ErrorState';
import LimitForm from '../components/LimitForm';
import LimitItem, {
  useStatLabel,
  type StatBase,
} from '../components/LimitItem';
import TransactionDrilldown from '../components/TransactionDrilldown';
import type { ParamUpdates } from '../components/TransactionTable';
import PushCard from '../components/PushCard';
import CollapsibleCard from '../../shared/components/CollapsibleCard';
import Toasts from '../../shared/components/Toasts';
import { fmtDateLong, fmtMonth } from '../../shared/format';
import { fetchLimits, type LimitOut } from '../api';
import './limits.css';
// .tx-panel/.tx-table styles — the drill-down reuses the
// transactions page's table chrome.
import './transactions.css';

/**
 * React port of limits.html as a mobile-first column of
 * collapsible cards: "Limit overview" (open by default) holds the
 * month dropdown (`?month=YYYY-MM` re-evaluates windows as of that
 * month's last day server-side) and a compact list of limit cards
 * with window progress bars and past-month history; "Set a limit"
 * holds the create/edit form (driven by the `?edit=<id>` param,
 * auto-opens while editing); "Spending alerts" holds the push
 * card and is hidden when no VAPID key is configured.
 *
 * All money figures arrive precomputed as Decimal strings inside
 * `window_stats` — rendered verbatim, never parsed into floats.
 */
export default function Limits() {
  const { t } = useTranslation('finance');
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get('month');
  const editParam = searchParams.get('edit');
  // Drill-down selection: `limit`/`window` identify the clicked
  // stat for highlighting and the heading; `category`/`account`/
  // `from`/`to` are the filters the transaction fetch runs with
  // (written together so the drilled-down URL is shareable).
  const params = {
    limit: searchParams.get('limit'),
    window: searchParams.get('window'),
    category: searchParams.get('category'),
    account: searchParams.get('account'),
    from: searchParams.get('from'),
    to: searchParams.get('to'),
    creditor: searchParams.get('creditor'),
    q: searchParams.get('q'),
    source: searchParams.get('source'),
    sort: searchParams.get('sort'),
    direction: searchParams.get('direction'),
    page: searchParams.get('page'),
  };
  const statLabel = useStatLabel();

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'limits', month ?? ''],
    queryFn: () => fetchLimits(month),
  });

  const [overviewOpen, setOverviewOpen] = useState(true);
  const [formOpen, setFormOpen] = useState(Boolean(editParam));
  const [alertsOpen, setAlertsOpen] = useState(false);

  // Opening a limit for edit (deep link or the row's pencil)
  // expands the form section, like the template swapping the
  // form instance.
  useEffect(() => {
    if (editParam) setFormOpen(true);
  }, [editParam]);
  // With nothing configured yet the form is the useful next step.
  useEffect(() => {
    if (data && data.limits.length === 0) setFormOpen(true);
  }, [data]);

  // The template resolves ?edit= against the user's limits;
  // an unknown/stale id just falls back to the create form.
  const editing =
    data?.limits.find((limit) => String(limit.id) === editParam) ?? null;

  // The form sits below the overview — when an edit starts,
  // bring it on screen (the pencil tap happened up top).
  const formSectionRef = useRef<HTMLDivElement>(null);
  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (editingId !== null) {
      formSectionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }, [editingId]);

  // Every param write mirrors a template navigation: the overview
  // GET form only carried `month`, the edit link only `edit`, and
  // save/cancel redirected to the bare limits URL — collapsing the
  // form is the equivalent return-to-overview.
  const selectMonth = (value: string) =>
    setSearchParams(value ? { month: value } : {});
  const startEdit = (id: number) => setSearchParams({ edit: String(id) });
  const clearParams = () => setSearchParams({});
  const finishEditing = () => {
    clearParams();
    setFormOpen(false);
  };

  /** Merge updates into the URL; `null`/'' removes the key. Any
      change other than explicit pagination lands back on page 1. */
  const updateParams = (updates: ParamUpdates) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in updates)) next.delete('page');
    setSearchParams(next);
  };

  // The params a stat click writes — cleared together when the
  // drill-down closes (the table's own sort/filter params persist,
  // like on the category overview).
  const DRILL_KEYS = ['limit', 'window', 'category', 'account', 'from', 'to'];
  const clearDrill = () =>
    updateParams(Object.fromEntries(DRILL_KEYS.map((key) => [key, null])));

  /** Window stat click — opens/closes the transaction drill-down
      with the limit's category, accounts and that window's exact
      date range. */
  const selectWindow = (limit: LimitOut, stat: StatBase) => {
    const windowKey = stat.key ?? stat.value ?? stat.label;
    const alreadyOpen =
      params.limit === String(limit.id) && params.window === windowKey;
    if (alreadyOpen) {
      clearDrill();
      return;
    }
    updateParams({
      limit: String(limit.id),
      window: windowKey,
      category: limit.category ? String(limit.category.id) : null,
      account: limit.accounts.map((a) => a.id).join(','),
      from: stat.date_from ?? null,
      to: stat.date_to ?? null,
    });
  };

  // Drill-down heading: "Groceries · This month" — resolved from
  // the payload, with the categories list as fallback for a
  // deep-linked selection whose limit id is stale.
  const drillLimit = data?.limits.find(
    (limit) => String(limit.id) === params.limit,
  );
  const drillStat = drillLimit?.window_stats
    .flatMap((stat) => [stat, ...stat.history])
    .find((stat) => (stat.key ?? stat.value) === params.window);
  const drillLabel = [
    drillLimit?.category?.name ??
      data?.categories.find(
        (category) => String(category.id) === params.category,
      )?.name ??
      '',
    drillStat ? statLabel(drillStat) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const overCount =
    data?.limits.filter((limit) => limit.window_stats.some((stat) => stat.over))
      .length ?? 0;

  return (
    <>
      <FinanceNavBar />
      <PageShell
        narrow
        title={t('limits.title')}
        subtitle={<span className="small">{t('limits.subtitle')}</span>}
      >
        {isPending && (
          <LoadingSkeleton
            rows={3}
            height="4.5rem"
            label={t('limits.loading')}
          />
        )}
        {isError && (
          <ErrorState
            error={error}
            onRetry={() => refetch()}
            label={t('limits.loadLabel')}
          />
        )}
        {data && (
          <>
            <div className="limits-section">
              <CollapsibleCard
                title={t('limits.overview')}
                open={overviewOpen}
                onToggle={() => setOverviewOpen((open) => !open)}
                badge={
                  overCount > 0 ? (
                    <span className="badge rounded-pill text-bg-danger">
                      {t('limits.overBadge', { count: overCount })}
                    </span>
                  ) : undefined
                }
              >
                {data.limits.length > 0 ? (
                  <>
                    <div className="d-flex align-items-center gap-2 flex-wrap mb-2">
                      <label
                        className="form-label mb-0 small text-muted"
                        htmlFor="overview-month"
                      >
                        {t('limits.overviewLabel')}
                      </label>
                      <select
                        id="overview-month"
                        name="month"
                        className="form-select form-select-sm w-auto"
                        value={data.selected_month ?? ''}
                        onChange={(event) => selectMonth(event.target.value)}
                      >
                        {data.overview_months.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.value
                              ? fmtMonth(option.value)
                              : t('server:periods.thisMonth', {
                                  defaultValue: option.label,
                                })}
                          </option>
                        ))}
                      </select>
                      {data.selected_month && (
                        <button
                          type="button"
                          className="btn btn-link btn-sm"
                          onClick={clearParams}
                        >
                          {t('limits.backToThisMonth')}
                        </button>
                      )}
                      <span
                        className={`ms-auto small ${
                          overCount > 0 ? 'text-danger' : 'limits-on-track'
                        }`}
                      >
                        <i
                          className={`bi me-1 ${
                            overCount > 0
                              ? 'bi-exclamation-circle'
                              : 'bi-check-circle'
                          }`}
                          aria-hidden="true"
                        />
                        {overCount > 0
                          ? t('limits.limitsExceeded', {
                              count: overCount,
                              total: data.limits.length,
                            })
                          : t('limits.allOnTrack')}
                      </span>
                    </div>
                    {data.selected_month && data.as_of && (
                      <p className="text-muted small">
                        {t('limits.evaluatedAsOf', {
                          date: fmtDateLong(`${data.as_of}T00:00:00`),
                        })}
                      </p>
                    )}
                    {data.limits.map((limit) => (
                      <LimitItem
                        key={limit.id}
                        limit={limit}
                        onEdit={() => startEdit(limit.id)}
                        selectedWindow={
                          params.limit === String(limit.id)
                            ? params.window
                            : null
                        }
                        onSelectWindow={
                          limit.category
                            ? (stat) => selectWindow(limit, stat)
                            : undefined
                        }
                      />
                    ))}
                  </>
                ) : (
                  <EmptyState
                    icon="speedometer2"
                    title={t('limits.emptyTitle')}
                  />
                )}
              </CollapsibleCard>
            </div>

            {params.category && (
              <TransactionDrilldown
                // Remount per selection so the panel scrolls into
                // view on every stat click.
                key={`${params.limit}:${params.window}`}
                label={drillLabel}
                params={{
                  category: params.category,
                  account: params.account,
                  from: params.from,
                  to: params.to,
                  creditor: params.creditor,
                  q: params.q,
                  source: params.source,
                  sort: params.sort,
                  direction: params.direction,
                  page: params.page,
                }}
                onUpdate={updateParams}
                onClose={clearDrill}
              />
            )}

            <div ref={formSectionRef} className="limits-section">
              <CollapsibleCard
                title={
                  editing ? t('limits.formTitleEdit') : t('limits.formTitleNew')
                }
                open={formOpen}
                onToggle={() => setFormOpen((open) => !open)}
              >
                <LimitForm
                  // Remount on edit target change so the fields
                  // re-initialize from that limit (the template's
                  // form instance swap).
                  key={editing?.id ?? 'new'}
                  accounts={data.accounts}
                  categories={data.categories}
                  editing={editing}
                  onSaved={finishEditing}
                  onCancelEdit={finishEditing}
                />
              </CollapsibleCard>
            </div>

            {data.push_config.vapid_public_key && (
              <div className="limits-section">
                <CollapsibleCard
                  title={t('limits.alertsTitle')}
                  open={alertsOpen}
                  onToggle={() => setAlertsOpen((open) => !open)}
                >
                  <PushCard config={data.push_config} />
                </CollapsibleCard>
              </div>
            )}
          </>
        )}
      </PageShell>
      <Toasts />
    </>
  );
}
