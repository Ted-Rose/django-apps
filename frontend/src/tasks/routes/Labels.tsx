import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import EmptyStateView from '../../shared/components/EmptyState';
import PageNavBar from '../../shared/components/PageNavBar';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { fetchLabels, type LabelOut } from '../api';
import { useUpdateLabel } from '../mutations';
import Toasts from '../../shared/components/Toasts';
import { spaPathFromStoredUrl } from '../utils';
import { ErrorState, LoadingSkeleton } from './TaskListPage';

/**
 * Label management page (badge colors) — a standalone page in the
 * Archived/Search/Stats shape: minimal navbar (back-to-dashboard +
 * brand + search + burger), Toasts, and the shared
 * ErrorState/LoadingSkeleton.
 *
 * Each row keeps a draft color: the native color picker (continuous
 * onChange while dragging) and a hex text input both write the draft,
 * the badge preview recolors live, and an explicit Save posts
 * /api/tasks/label/{id}/update/. Labels are app-level only — they
 * never sync to Google Tasks.
 */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export default function Labels() {
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['labels'],
    queryFn: fetchLabels,
  });

  // Same back-button capture as Stats: read the stored view before
  // the effect below rewrites it, and never point back at /labels
  // itself (a reload would make the back link a no-op).
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
    return resolved && !resolved.startsWith('/labels') ? resolved : '/';
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
  }, []);

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
      <PageNavBar
        variant="primary"
        burgerItems={burgerItems}
        actions={
          <Link
            to="/search"
            className="btn btn-outline-light btn-sm ui-nav-toggle"
            title={t('menu.searchTasks')}
          >
            <i className="bi bi-search" />
          </Link>
        }
      >
        <Link
          to={backTarget}
          className="btn btn-outline-light btn-sm ui-nav-toggle"
          id="back-to-dashboard-btn"
        >
          <i className="bi bi-arrow-left" /> {t('labelsPage.back')}
        </Link>
        <Link className="navbar-brand mb-0" to="/labels">
          <i className="bi bi-tags" /> {t('labelsPage.title')}
        </Link>
      </PageNavBar>

      <div className="container-fluid px-2 py-4">
        {isPending && <LoadingSkeleton />}
        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {data &&
          (data.labels.length === 0 ? (
            <EmptyStateView icon="tags" title={t('labelsPage.empty')} />
          ) : (
            <div className="card ui-card">
              <div className="card-header py-1 fw-semibold">
                {t('labelsPage.title')}
              </div>
              <div className="card-body py-2 px-3">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>{t('labelsPage.name')}</th>
                      <th className="text-end">{t('labelsPage.tasks')}</th>
                      <th>{t('labelsPage.color')}</th>
                      <th className="text-end">{t('labelsPage.actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.labels.map((label) => (
                      <LabelRow key={label.id} label={label} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
      </div>
      <Toasts />
    </>
  );
}

/**
 * One label row: badge preview in the draft color, task count, a
 * native color picker plus a hex text input, and a per-row Save that
 * stays disabled until the draft is a valid #RRGGBB differing from
 * the saved color.
 */
function LabelRow({ label }: { label: LabelOut }) {
  const { t } = useTranslation('tasks');
  const [draft, setDraft] = useState(label.color);
  const updateLabel = useUpdateLabel();
  const valid = HEX_RE.test(draft);
  const dirty = valid && draft.toLowerCase() !== label.color.toLowerCase();
  return (
    <tr>
      <td>
        <span
          className="badge"
          style={{ backgroundColor: valid ? draft : label.color }}
        >
          {label.name}
        </span>
      </td>
      <td className="text-end">{label.task_count ?? 0}</td>
      <td>
        <div className="d-flex align-items-center gap-2">
          <input
            type="color"
            className="form-control form-control-color label-color-input"
            value={valid ? draft : label.color}
            onChange={(event) => setDraft(event.target.value)}
            title={t('labelsPage.color')}
          />
          <input
            type="text"
            className={`form-control form-control-sm label-hex-input${
              valid ? '' : ' is-invalid'
            }`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t('labelsPage.hexColor')}
            title={valid ? undefined : t('labelsPage.invalidColor')}
          />
        </div>
      </td>
      <td className="text-end">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!dirty || updateLabel.isPending}
          onClick={() =>
            updateLabel.mutate({ labelId: label.id, color: draft })
          }
        >
          {updateLabel.isPending ? (
            <span className="spinner-border spinner-border-sm" />
          ) : (
            t('labelsPage.save')
          )}
        </button>
      </td>
    </tr>
  );
}
