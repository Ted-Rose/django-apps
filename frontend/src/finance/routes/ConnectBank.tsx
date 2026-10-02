import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import FinanceNavBar from '../components/FinanceNavBar';
import PageShell from '../components/PageShell';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Toasts from '../../shared/components/Toasts';
import { fetchInstitutions } from '../api';
import { useConnectBank } from '../mutations';
import { errorDetail } from '../../shared/api/errors';
import { pushToast } from '../../shared/toasts';
import './connect.css';

/**
 * React port of connect_bank.html — a GET "country" form driving
 * `?country=` (kept in the URL so results stay shareable), the
 * institutions endpoint feeding a radio-card bank list, and a POST
 * to /api/finance/connect/ whose `link` the browser navigates to
 * for bank consent. Like the template, the institutions fetch only
 * runs once a country is chosen; upstream GoCardless failures (502)
 * surface as toasts instead of messages.error.
 *
 * The country input is uncontrolled and remounted via `key` when
 * the URL param changes (back/forward navigation), so its value
 * always tracks ?country= with `lv` as the default.
 */
export default function ConnectBank() {
  const { t } = useTranslation('finance');
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
        t('connect.loadError', { detail: errorDetail(error) }),
        'warning',
      );
    }
  }, [isError, error, t]);

  return (
    <>
      <FinanceNavBar />
      <PageShell
        title={t('connect.title')}
        subtitle={t('connect.subtitle')}
        narrow
      >
        <div className="fin-card connect-card">
          <section className="connect-step">
            <h2 className="connect-step-title">
              <span className="connect-step-num" aria-hidden="true">
                1
              </span>
              {t('connect.stepCountry')}
            </h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = String(
                  new FormData(event.currentTarget).get('country') ??
                    '',
                ).trim();
                setSearchParams(value ? { country: value } : {});
              }}
            >
              <label htmlFor="id_country" className="form-label">
                {t('connect.countryLabel')}
              </label>
              <div className="d-flex align-items-start gap-2">
                <input
                  type="text"
                  name="country"
                  id="id_country"
                  key={country}
                  className="form-control connect-country-input"
                  maxLength={2}
                  defaultValue={country || 'lv'}
                />
                <button type="submit" className="btn btn-primary">
                  <i className="bi bi-search" /> {t('connect.findBanks')}
                </button>
              </div>
              <div className="form-text">{t('connect.countryHint')}</div>
            </form>
          </section>

          {isPending && country && (
            <section className="connect-step">
              <h2 className="connect-step-title">
                <span
                  className="connect-step-num"
                  aria-hidden="true"
                >
                  2
                </span>
                {t('connect.stepBank')}
              </h2>
              <LoadingSkeleton
                rows={3}
                height="3.25rem"
                label={t('connect.loadingBanks')}
              />
            </section>
          )}

          {institutions.length > 0 && (
            <section className="connect-step">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const institutionId = String(
                    new FormData(event.currentTarget).get(
                      'institution_id',
                    ) ?? '',
                  );
                  if (institutionId) connect.mutate(institutionId);
                }}
              >
                <fieldset className="connect-step-fieldset">
                  <legend className="connect-step-title">
                    <span
                      className="connect-step-num"
                      aria-hidden="true"
                    >
                      2
                    </span>
                    {t('connect.stepBank')}
                  </legend>
                  <div className="connect-banks">
                    {institutions.map((institution, index) => (
                      <label
                        key={institution.id}
                        className="connect-bank"
                      >
                        <input
                          type="radio"
                          name="institution_id"
                          value={institution.id}
                          className="form-check-input"
                          defaultChecked={index === 0}
                          required
                        />
                        {institution.logo ? (
                          <img
                            src={institution.logo}
                            alt=""
                            className="connect-bank-logo"
                          />
                        ) : (
                          <i
                            className="bi bi-bank2 connect-bank-icon"
                            aria-hidden="true"
                          />
                        )}
                        <span className="connect-bank-name">
                          {institution.name}
                        </span>
                        {institution.bic && (
                          <span className="connect-bank-bic">
                            {institution.bic}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary w-100"
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
                    {t('connect.connect')}
                  </button>
                </fieldset>
              </form>
            </section>
          )}
        </div>
      </PageShell>
      <Toasts />
    </>
  );
}
