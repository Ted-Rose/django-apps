import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import { BurgerMenu } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchStats, type StatsBucketOut, type StatsOut } from '../api';
import Toasts from '../../shared/components/Toasts';
import { MONTHS, formatShortDate, spaPathFromStoredUrl } from '../utils';
import { ErrorState, LoadingSkeleton } from './TaskListPage';

/**
 * Completed-tasks productivity dashboard (TASKS_PRODUCTIVITY_STATS
 * plan) — a standalone page in the Archived/Search shape: minimal
 * navbar (back-to-dashboard + brand + search + burger), Toasts, and
 * the shared ErrorState/LoadingSkeleton.
 *
 * The API returns zero-filled UTC weekly/monthly buckets, each split
 * by label and task list, so this page is pure rendering: summary
 * cards, two CSS stacked-bar charts (no chart library — segments are
 * colored divs with title= tooltips), a per-label table that makes
 * the multi-label double-counting explicit, and a per-list
 * breakdown. Bars scale against the window max; the current period
 * is always the last (zero-filled) bucket.
 *
 * Own ['stats', …] query root — NOT ['dashboard']: the mutation
 * hooks patch that family as DashboardOut, which StatsOut is not.
 * weeks/months/list are URL params so filtered stats stay
 * bookmarkable.
 */
const UNLABELED_COLOR = '#6c757d';

export default function Stats() {
  const { t } = useTranslation('tasks');
  const [searchParams] = useSearchParams();
  const weeks = Number(searchParams.get('weeks')) || undefined;
  const months = Number(searchParams.get('months')) || undefined;
  const list = searchParams.get('list');
  const navigate = useNavigate();

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['stats', { weeks, months, list }],
    queryFn: () => fetchStats({ weeks, months, list }),
    placeholderData: keepPreviousData,
  });

  // Read before the lastTasksView effect below writes this page —
  // captured once so the back button keeps pointing at the previous
  // page. On a reload the stored view IS /stats (written by the
  // previous mount), so fall back to the dashboard rather than
  // rendering a no-op back link to the current page.
  const [backTarget] = useState(() => {
    const resolved = spaPathFromStoredUrl(
      (() => {
        try {
          return localStorage.getItem('lastTasksView');
        } catch {
          return null;
        }
      })(),
    );
    return resolved && !resolved.startsWith('/stats') ? resolved : '/';
  });

  // filters.js saveCurrentView() — same as every tasks page.
  useEffect(() => {
    try {
      localStorage.setItem(
        'lastTasksView',
        window.location.pathname + window.location.search,
      );
    } catch {
      // Storage unavailable — non-fatal.
    }
  }, [weeks, months, list]);

  const labelColors = useMemo(
    () => new Map((data?.labels ?? []).map((l) => [l.name, l.color])),
    [data],
  );

  const burgerItems: BurgerMenuItem[] = [
    {
      label: t('common:common.home'),
      url: '/',
      icon: 'house',
      btn_class: 'btn-light',
    },
    {
      label: t('menu.notes'),
      url: '/notes/',
      icon: 'journal-text',
      btn_class: 'btn-light',
    },
    {
      label: t('common:common.dashboard'),
      icon: 'list-task',
      btn_class: 'btn-primary',
      onClick: () => navigate('/'),
    },
    {
      label: t('common:common.logout', { user }),
      url: '/admin/logout/',
      icon: 'box-arrow-right',
      btn_class: 'btn-outline-light',
    },
  ];

  return (
    <>
      <nav
        className="navbar navbar-expand-lg navbar-dark bg-primary"
        style={{ padding: '0.1rem 0', minHeight: 'auto' }}
      >
        <div className="container-fluid" style={{ padding: '0 0.5rem' }}>
          <div className="d-flex align-items-center gap-1 flex-wrap flex-grow-1">
            <Link
              to={backTarget}
              className="btn btn-outline-light btn-sm"
              style={{ padding: '0.15rem 0.4rem' }}
              id="back-to-dashboard-btn"
            >
              <i className="bi bi-arrow-left" /> {t('stats.back')}
            </Link>
            <Link
              className="navbar-brand mb-0"
              to="/stats"
              style={{ fontSize: '1rem', padding: '0.25rem 0.5rem' }}
            >
              <i className="bi bi-bar-chart" /> {t('stats.title')}
            </Link>
          </div>
          <div className="ms-auto d-flex flex-row align-items-center gap-2">
            <Link
              to="/search"
              className="btn btn-outline-light btn-sm"
              style={{ padding: '0.25rem 0.5rem' }}
              title={t('menu.searchTasks')}
            >
              <i className="bi bi-search" />
            </Link>
            <BurgerMenu items={burgerItems} />
          </div>
        </div>
      </nav>

      <div className="container-fluid px-2 py-4">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data &&
          (data.summary.all_time === 0 ? (
            <div className="alert alert-info">
              <i className="bi bi-info-circle" /> {t('stats.empty')}
            </div>
          ) : (
            <StatsBody data={data} labelColors={labelColors} />
          ))}
      </div>
      <Toasts />
    </>
  );
}

function StatsBody({
  data,
  labelColors,
}: {
  data: StatsOut;
  labelColors: Map<string, string>;
}) {
  const { t } = useTranslation('tasks');
  const { summary } = data;
  return (
    <>
      <div className="row row-cols-2 row-cols-md-3 row-cols-xl-5 g-2 mb-3">
        <SummaryCard
          label={t('stats.thisWeek')}
          value={summary.this_week}
          delta={summary.this_week - summary.last_week}
        />
        <SummaryCard label={t('stats.lastWeek')} value={summary.last_week} />
        <SummaryCard
          label={t('stats.thisMonth')}
          value={summary.this_month}
          delta={summary.this_month - summary.last_month}
        />
        <SummaryCard label={t('stats.lastMonth')} value={summary.last_month} />
        <SummaryCard
          label={t('stats.allTime')}
          value={summary.all_time}
          footnote={
            summary.unknown_date > 0
              ? t('stats.unknownDate', { total: summary.unknown_date })
              : undefined
          }
        />
      </div>
      <BucketChart
        title={t('stats.weeklyTitle')}
        buckets={data.weekly}
        labelColors={labelColors}
        formatStart={weekStartLabel}
        tipKey="stats.weekTip"
      />
      <BucketChart
        title={t('stats.monthlyTitle')}
        buckets={data.monthly}
        labelColors={labelColors}
        formatStart={monthStartLabel}
        tipKey="stats.monthTip"
      />
      <div className="row g-3">
        <div className="col-md-6">
          <LabelBreakdown data={data} labelColors={labelColors} />
        </div>
        <div className="col-md-6">
          <ListBreakdown data={data} />
        </div>
      </div>
    </>
  );
}

function SummaryCard({
  label,
  value,
  delta,
  footnote,
}: {
  label: string;
  value: number;
  delta?: number;
  footnote?: string;
}) {
  return (
    <div className="col">
      <div className="card h-100">
        <div className="card-body py-2 px-3">
          <div className="text-muted small text-truncate">{label}</div>
          <div className="d-flex align-items-baseline gap-2">
            <span className="fs-3 fw-semibold">{value}</span>
            {delta !== undefined && delta !== 0 && (
              <small className={delta > 0 ? 'text-success' : 'text-danger'}>
                {delta > 0 ? `+${delta}` : delta}
              </small>
            )}
          </div>
          {footnote && <small className="text-muted">{footnote}</small>}
        </div>
      </div>
    </div>
  );
}

/**
 * One zero-filled bucket series as CSS stacked bars: every column is
 * a bucket, segments are sized ∝ their share of the window max and
 * colored by label (unlabeled = grey on top). The last bucket is the
 * current, possibly partial, period — marked with a bold label.
 */
function BucketChart({
  title,
  buckets,
  labelColors,
  formatStart,
  tipKey,
}: {
  title: string;
  buckets: StatsBucketOut[];
  labelColors: Map<string, string>;
  formatStart: (start: string) => string;
  tipKey: string;
}) {
  const { t } = useTranslation('tasks');
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const lastIndex = buckets.length - 1;
  return (
    <div className="card mb-3">
      <div className="card-header py-1 fw-semibold">{title}</div>
      <div className="card-body py-2 px-2">
        <div className="d-flex align-items-stretch gap-1">
          {buckets.map((bucket, index) => {
            // A multi-labeled task counts once per label, so segments
            // can sum above total — normalize so the column height
            // stays ∝ total/max like the other bars.
            const segmentSum =
              bucket.unlabeled +
              Object.values(bucket.by_label).reduce((sum, n) => sum + n, 0);
            const scale = segmentSum > 0 ? bucket.total / segmentSum : 0;
            const segmentHeight = (count: number) =>
              `${((count * scale) / max) * 100}%`;
            return (
              <div
                key={bucket.start}
                className="d-flex flex-column flex-grow-1"
                style={{ minWidth: 0 }}
              >
                <div
                  className="d-flex flex-column justify-content-end"
                  style={{ height: '8rem' }}
                  title={t(tipKey, {
                    date: formatStart(bucket.start),
                    total: bucket.total,
                  })}
                >
                  {bucket.unlabeled > 0 && (
                    <div
                      className="stats-bar-segment"
                      style={{
                        height: segmentHeight(bucket.unlabeled),
                        minHeight: '2px',
                        backgroundColor: UNLABELED_COLOR,
                      }}
                    />
                  )}
                  {Object.entries(bucket.by_label).map(([name, count]) => (
                    <div
                      key={name}
                      className="stats-bar-segment"
                      style={{
                        height: segmentHeight(count),
                        minHeight: '2px',
                        backgroundColor:
                          labelColors.get(name) ?? UNLABELED_COLOR,
                      }}
                    />
                  ))}
                </div>
                <div
                  className={`text-center text-truncate${
                    index === lastIndex
                      ? ' fw-bold text-primary'
                      : ' text-muted'
                  }`}
                  style={{ fontSize: '0.6rem' }}
                >
                  {formatStart(bucket.start)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface BreakdownRow {
  key: string;
  label: string;
  color?: string;
  count: number;
  share: number;
}

function LabelBreakdown({
  data,
  labelColors,
}: {
  data: StatsOut;
  labelColors: Map<string, string>;
}) {
  const { t } = useTranslation('tasks');
  // Per-label totals over the monthly window (the wider default
  // window); the weekly chart covers the shorter recent stretch.
  const rows = useMemo(() => {
    const totals = new Map<string, number>();
    let unlabeled = 0;
    let windowTotal = 0;
    for (const bucket of data.monthly) {
      windowTotal += bucket.total;
      unlabeled += bucket.unlabeled;
      for (const [name, count] of Object.entries(bucket.by_label)) {
        totals.set(name, (totals.get(name) ?? 0) + count);
      }
    }
    const denom = Math.max(1, windowTotal);
    const result: BreakdownRow[] = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        key: name,
        label: name,
        color: labelColors.get(name) ?? UNLABELED_COLOR,
        count,
        share: Math.round((count / denom) * 100),
      }));
    if (unlabeled > 0) {
      result.push({
        key: '',
        label: t('stats.unlabeled'),
        color: UNLABELED_COLOR,
        count: unlabeled,
        share: Math.round((unlabeled / denom) * 100),
      });
    }
    return result;
  }, [data, labelColors, t]);

  return (
    <div className="card h-100">
      <div className="card-header py-1 fw-semibold">{t('stats.byLabel')}</div>
      <div className="card-body py-2 px-3">
        <table className="table table-sm mb-1">
          <thead>
            <tr>
              <th>{t('stats.label')}</th>
              <th className="text-end">{t('stats.total')}</th>
              <th className="text-end">{t('stats.share')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <span
                    className="badge"
                    style={{
                      backgroundColor: row.color ?? UNLABELED_COLOR,
                    }}
                  >
                    {row.label}
                  </span>
                </td>
                <td className="text-end">{row.count}</td>
                <td className="text-end">{row.share}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <small className="text-muted">{t('stats.multiLabelNote')}</small>
      </div>
    </div>
  );
}

function ListBreakdown({ data }: { data: StatsOut }) {
  const { t } = useTranslation('tasks');
  const rows = useMemo(() => {
    const totals = new Map<string, number>();
    let windowTotal = 0;
    for (const bucket of data.monthly) {
      windowTotal += bucket.total;
      for (const [title, count] of Object.entries(bucket.by_list)) {
        totals.set(title, (totals.get(title) ?? 0) + count);
      }
    }
    const denom = Math.max(1, windowTotal);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([title, count]): BreakdownRow => {
        // The API keys the NULL task_list group under '' — render it
        // as the localized "Unlisted" row.
        const unlisted = title === '';
        return {
          key: title,
          label: unlisted ? t('stats.unlisted') : title,
          count,
          share: Math.round((count / denom) * 100),
        };
      });
  }, [data, t]);

  return (
    <div className="card h-100">
      <div className="card-header py-1 fw-semibold">{t('stats.byList')}</div>
      <div className="card-body py-2 px-3">
        <table className="table table-sm mb-0">
          <thead>
            <tr>
              <th>{t('stats.list')}</th>
              <th className="text-end">{t('stats.total')}</th>
              <th className="text-end">{t('stats.share')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <i className="bi bi-folder me-1" />
                  {row.label}
                </td>
                <td className="text-end">{row.count}</td>
                <td className="text-end">{row.share}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Bucket-axis label for the weekly chart: "Mar 3". */
function weekStartLabel(start: string): string {
  return formatShortDate(start) ?? start;
}

/** Bucket-axis label for the monthly chart: "Mar 2026". */
function monthStartLabel(start: string): string {
  const match = /^(\d{4})-(\d{2})-/.exec(start);
  if (!match) return start;
  return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}
