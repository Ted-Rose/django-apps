import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import FinanceNavBar from '../components/FinanceNavBar';
import Toasts from '../../shared/components/Toasts';
import { fetchInstitutions } from '../api';
import { useConnectBank } from '../mutations';
import { errorDetail } from '../../shared/api/errors';
import { pushToast } from '../../shared/toasts';

/**
 * React port of connect_bank.html — a GET "country" form driving
 * `?country=` (kept in the URL so results stay shareable), the
 * institutions endpoint feeding a <select>, and a POST to
 * /api/finance/connect/ whose `link` the browser navigates to for
 * bank consent. Like the template, the institutions fetch only runs
 * once a country is chosen; upstream GoCardless failures (502)
 * surface as toasts instead of messages.error.
 *
 * The country input is uncontrolled and remounted via `key` when
 * the URL param changes (back/forward navigation), so its value
 * always tracks ?country= with `lv` as the default.
 */
export default function ConnectBank() {
  const [searchParams, setSearchParams] = useSearchParams();
  const country = (searchParams.get('country') ?? '').trim();
  const connect = useConnectBank();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['finance', 'institutions', country],
    queryFn: () => fetchInstitutions(country),
    enabled: country.length > 0,
  });
  const institutions = data?.institutions ?? [];

  // Institutions fetch failures (incl. 502 upstream_error from
  // GoCardlessError) become toasts — the template's messages.error.
  useEffect(() => {
    if (isError) {
      pushToast(
        `Could not load institutions: ${errorDetail(error)}`,
        'warning',
      );
    }
  }, [isError, error]);

  return (
    <>
      <FinanceNavBar />
      <div className="container-fluid px-2 py-4">
        <h1 className="mb-4">Connect a Bank</h1>

        <form
          className="row g-2 align-items-end mb-4"
          onSubmit={(event) => {
            event.preventDefault();
            const value = String(
              new FormData(event.currentTarget).get('country') ?? '',
            ).trim();
            setSearchParams(value ? { country: value } : {});
          }}
        >
          <div className="col-auto">
            <label htmlFor="id_country" className="form-label">
              Country
            </label>
            <input
              type="text"
              name="country"
              id="id_country"
              key={country}
              className="form-control"
              maxLength={2}
              defaultValue={country || 'lv'}
            />
            <div className="form-text">
              Two-letter country code (e.g. lv, gb, de)
            </div>
          </div>
          <div className="col-auto">
            <button type="submit" className="btn btn-primary">
              <i className="bi bi-search" /> Find Banks
            </button>
          </div>
        </form>

        {isPending && country && (
          <div
            className="mb-4 text-muted"
            aria-busy="true"
            aria-label="Loading banks"
          >
            <span
              className="spinner-border spinner-border-sm me-2"
              role="status"
            />
            Finding banks…
          </div>
        )}

        {institutions.length > 0 && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const institutionId = String(
                new FormData(event.currentTarget).get('institution_id') ?? '',
              );
              if (institutionId) connect.mutate(institutionId);
            }}
          >
            <div className="mb-3">
              <label htmlFor="id_institution_id" className="form-label">
                Select your bank
              </label>
              <select
                name="institution_id"
                id="id_institution_id"
                className="form-select"
                required
              >
                {institutions.map((institution) => (
                  <option key={institution.id} value={institution.id}>
                    {institution.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="btn btn-success"
              disabled={connect.isPending}
            >
              {connect.isPending ? (
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                />
              ) : (
                <i className="bi bi-link-45deg" />
              )}{' '}
              Connect
            </button>
          </form>
        )}
      </div>
      <Toasts />
    </>
  );
}
