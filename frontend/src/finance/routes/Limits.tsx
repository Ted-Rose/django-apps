import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import ErrorState from '../components/ErrorState';
import LimitForm from '../components/LimitForm';
import LimitRow from '../components/LimitRow';
import PushCard from '../components/PushCard';
import Toasts from '../../shared/components/Toasts';
import { fetchLimits } from '../api';

/**
 * React port of limits.html — the limit create/edit form (driven by
 * the `?edit=<id>` param, like the template view's `request.GET`),
 * the per-limit table with window progress bars and past-month
 * history, the overview month dropdown (`?month=YYYY-MM`
 * re-evaluates windows as of that month's last day server-side),
 * and the push-alert card.
 *
 * All money figures arrive precomputed as Decimal strings inside
 * `window_stats` — rendered verbatim, never parsed into floats.
 */
export default function Limits() {
  const [searchParams, setSearchParams] = useSearchParams();
  const month = searchParams.get('month');
  const editParam = searchParams.get('edit');

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['finance', 'limits', month ?? ''],
    queryFn: () => fetchLimits(month),
  });

  // The template resolves ?edit= against the user's limits;
  // an unknown/stale id just falls back to the create form.
  const editing =
    data?.limits.find((limit) => String(limit.id) === editParam) ?? null;

  // Every param write mirrors a template navigation: the overview
  // GET form only carried `month`, the edit link only `edit`, and
  // save/cancel redirected to the bare limits URL.
  const selectMonth = (value: string) =>
    setSearchParams(value ? { month: value } : {});
  const startEdit = (id: number) => setSearchParams({ edit: String(id) });
  const clearParams = () => setSearchParams({});

  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="mb-4">Spending Limits</h1>
        <p className="text-muted">
          Outgoing spending limits per account, optionally scoped to a single
          category. A limit can cover the last 7 days, the last 30 days, or the
          current calendar month. You are alerted when spending within a window
          exceeds the limit.
        </p>

        {isPending && (
          <div
            className="text-center py-5"
            aria-busy="true"
            aria-label="Loading limits"
          >
            <div className="spinner-border" role="status" />
          </div>
        )}
        {isError && (
          <ErrorState error={error} onRetry={() => refetch()} label="limits" />
        )}
        {data && (
          <div className="row g-3">
            <div className="col-md-5">
              <LimitForm
                // Remount on edit target change so the fields
                // re-initialize from that limit (the template's
                // form instance swap).
                key={editing?.id ?? 'new'}
                accounts={data.accounts}
                categories={data.categories}
                editing={editing}
                onSaved={clearParams}
                onCancelEdit={clearParams}
              />
              <PushCard config={data.push_config} />
            </div>
            <div className="col-md-7">
              {data.limits.length > 0 ? (
                <>
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <label
                      className="form-label mb-0 small text-muted"
                      htmlFor="overview-month"
                    >
                      Overview
                    </label>
                    <select
                      id="overview-month"
                      name="month"
                      className="form-select form-select-sm w-auto"
                      value={data.selected_month ?? ''}
                      onChange={(event) => selectMonth(event.target.value)}
                    >
                      {data.overview_months.map((option) => (
                        <option key={option.label} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {data.selected_month && (
                      <button
                        type="button"
                        className="btn btn-link btn-sm"
                        onClick={clearParams}
                      >
                        Back to this month
                      </button>
                    )}
                  </div>
                  {data.selected_month && data.as_of && (
                    <p className="text-muted small">
                      Windows evaluated as of{' '}
                      {new Date(`${data.as_of}T00:00:00`).toLocaleDateString(
                        undefined,
                        { month: 'long', day: 'numeric', year: 'numeric' },
                      )}{' '}
                      — the last day of the selected month — using current limit
                      values.
                    </p>
                  )}
                  <div className="table-responsive">
                    <table className="table table-striped">
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Category</th>
                          <th style={{ minWidth: '240px' }}>Spent / limit</th>
                          <th>Active</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.limits.map((limit) => (
                          <LimitRow
                            key={limit.id}
                            limit={limit}
                            onEdit={() => startEdit(limit.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="alert alert-info">No limits set yet.</div>
              )}
            </div>
          </div>
        )}
      </div>
      <Toasts />
    </>
  );
}
