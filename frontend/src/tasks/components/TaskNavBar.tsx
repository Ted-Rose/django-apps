import { Fragment } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BurgerMenu,
  type BurgerMenuItem,
} from '../../shared/components/BurgerMenu';
import Dropdown from '../../shared/components/Dropdown';
import type { DashboardOut } from '../api';
import SecondaryLabelDropdown from './SecondaryLabelDropdown';

/**
 * React port of components/dashboard/navbar.html — the fixed primary
 * navbar holding the view/label/order filter dropdowns, the search
 * button and the burger menu.
 *
 * Filter behavior is a port of js/dashboard/filters.js:
 * - `selectList` / `selectLabel` clear the other filters (and
 *   `secondary_label` / `sync`) and set their own query param.
 * - `changeOrder` sets `?order=` keeping the other params.
 * - `selectSecondaryLabel` stays CLIENT-SIDE: it only updates the
 *   `secondary_label` search param (shareable URL); no extra API
 *   param is sent — Dashboard filters the arrays in memory.
 *
 * Below the dropdowns a `.filter-chips` row shows one .ui-chip per
 * active ?list=/?label=/?secondary_label= param with an × clearing
 * it — the URL stays the source of truth.
 */
const TOGGLE_CLASS =
  'btn btn-outline-light btn-sm dropdown-toggle ui-nav-toggle';

/** Left group: wraps the filter dropdowns + chips on narrow widths. */
const FILTER_GROUP_CLASS =
  'd-flex align-items-center gap-1 flex-wrap flex-grow-1';

const ORDER_OPTIONS: { key: string; icon: string; labelKey: string }[] = [
  { key: 'order_desc', icon: 'sort-numeric-down', labelKey: 'orderDesc' },
  { key: 'order_asc', icon: 'sort-numeric-up', labelKey: 'orderAsc' },
  { key: 'created_desc', icon: 'calendar-plus', labelKey: 'createdDesc' },
  { key: 'created_asc', icon: 'calendar-plus', labelKey: 'createdAsc' },
  { key: 'due_desc', icon: 'calendar-event', labelKey: 'dueDesc' },
  { key: 'due_asc', icon: 'calendar-event', labelKey: 'dueAsc' },
  {
    key: 'completed_last',
    icon: 'check-circle',
    labelKey: 'completedLast',
  },
  {
    key: 'completed_first',
    icon: 'check-circle-fill',
    labelKey: 'completedFirst',
  },
];

interface TaskNavBarProps {
  /** Dashboard response once loaded; filters hide while loading. */
  data?: DashboardOut;
  secondaryLabel: string;
  burgerItems: BurgerMenuItem[];
}

function activeClass(active: boolean): string {
  return `dropdown-item${active ? ' active' : ''}`;
}

export function TaskNavBar({
  data,
  secondaryLabel,
  burgerItems,
}: TaskNavBarProps) {
  const { t } = useTranslation('tasks');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const flags = data?.flags;
  const hasCredentials = flags?.has_credentials ?? false;
  // The URL is the source of truth for the selected filters (the API
  // echoes the same values back as selected_*), so dropdowns stay
  // correct while a refetch is still in flight.
  const selectedList = searchParams.get('list');
  const selectedLabel = searchParams.get('label');
  const orderBy = searchParams.get('order') ?? data?.order_by ?? 'order_asc';
  const selectedListTitle =
    data?.task_lists.find((l) => l.list_id === selectedList)?.title ??
    data?.selected_list_title;
  const isSpecialView = Boolean(
    flags &&
    (flags.is_starred_view ||
      flags.is_overdue_view ||
      flags.is_archived_view ||
      flags.is_trash_view),
  );

  /** filters.js selectList: drop list/label/secondary_label/sync,
   *  keep order, then set the new list. From a special view
   *  (starred/overdue/archived/trash — endpoints that take no list
   *  filter) the original navigates back to the dashboard with the
   *  filter applied instead. */
  const selectList = (listId: string) => {
    if (isSpecialView) {
      navigate(`/${listId ? `?list=${encodeURIComponent(listId)}` : ''}`);
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete('list');
    params.delete('label');
    params.delete('secondary_label');
    params.delete('sync');
    if (listId) params.set('list', listId);
    setSearchParams(params);
  };

  /** filters.js selectLabel — same reset pattern as selectList,
   *  with the same special-view bounce to the dashboard. */
  const selectLabel = (labelName: string) => {
    if (isSpecialView) {
      navigate(
        `/${labelName ? `?label=${encodeURIComponent(labelName)}` : ''}`,
      );
      return;
    }
    const params = new URLSearchParams(searchParams);
    params.delete('list');
    params.delete('label');
    params.delete('secondary_label');
    params.delete('sync');
    if (labelName) params.set('label', labelName);
    setSearchParams(params);
  };

  /** filters.js changeOrder: keep other params, replace order. */
  const changeOrder = (orderKey: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete('sync');
    if (orderKey) {
      params.set('order', orderKey);
    } else {
      params.delete('order');
    }
    setSearchParams(params);
  };

  /** Filter chip × — clears just that one param, keeps the rest. */
  const clearFilter = (key: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete(key);
    setSearchParams(params);
  };

  const filterChips: { key: string; label: string }[] = [];
  if (selectedList) {
    filterChips.push({
      key: 'list',
      label: selectedListTitle ?? t('views.list'),
    });
  }
  if (selectedLabel) {
    filterChips.push({ key: 'label', label: selectedLabel });
  }
  if (secondaryLabel) {
    filterChips.push({ key: 'secondary_label', label: secondaryLabel });
  }

  const viewLabel = flags?.is_starred_view ? (
    <>
      <i className="bi bi-star-fill text-warning" /> {t('views.starred')}
    </>
  ) : flags?.is_overdue_view ? (
    <>
      <i className="bi bi-exclamation-triangle text-warning" />{' '}
      {t('views.overdue')}
    </>
  ) : flags?.is_archived_view ? (
    <>
      <i className="bi bi-archive" /> {t('views.archive')}
    </>
  ) : flags?.is_trash_view ? (
    <>
      <i className="bi bi-trash" /> {t('views.trash')}
    </>
  ) : selectedList ? (
    <>
      <i className="bi bi-folder" /> {selectedListTitle ?? t('views.list')}
    </>
  ) : selectedLabel ? (
    <>
      <i className="bi bi-tag" /> {selectedLabel}
    </>
  ) : (
    <>
      <i className="bi bi-list-task" /> {t('views.allTasks')}
    </>
  );

  const isDashboardDefault = !selectedList && !selectedLabel && !isSpecialView;

  return (
    <nav className="app-navbar navbar navbar-expand-lg navbar-dark bg-primary">
      <div className="container-fluid">
        {data && hasCredentials && (
          <div className={FILTER_GROUP_CLASS}>
            {/* View dropdown: All Tasks + special views + labels + lists */}
            <Dropdown label={viewLabel} buttonClassName={TOGGLE_CLASS}>
              <li>
                <Link className={activeClass(isDashboardDefault)} to="/">
                  <i className="bi bi-list-task" /> {t('views.allTasks')}
                </Link>
              </li>
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <Link
                  className={activeClass(Boolean(flags?.is_starred_view))}
                  to="/starred"
                >
                  <i className="bi bi-star-fill text-warning" />{' '}
                  {t('views.starred')}
                </Link>
              </li>
              <li>
                <Link
                  className={activeClass(Boolean(flags?.is_overdue_view))}
                  to="/overdue"
                >
                  <i className="bi bi-exclamation-triangle text-danger" />{' '}
                  {t('views.overdue')}
                </Link>
              </li>
              <li>
                <Link
                  className={activeClass(Boolean(flags?.is_archived_view))}
                  to="/archived"
                >
                  <i className="bi bi-archive" /> {t('views.archive')}
                </Link>
              </li>
              <li>
                <Link
                  className={activeClass(Boolean(flags?.is_trash_view))}
                  to="/trash"
                >
                  <i className="bi bi-trash" /> {t('views.trash')}
                </Link>
              </li>
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <Link className="dropdown-item" to="/stats">
                  <i className="bi bi-bar-chart" /> {t('stats.title')}
                </Link>
              </li>
              {data.labels.length > 0 && (
                <>
                  <li>
                    <hr className="dropdown-divider" />
                  </li>
                  <li>
                    <h6 className="dropdown-header">{t('views.labels')}</h6>
                  </li>
                  {data.labels.map((label) => (
                    <li key={label.id}>
                      <a
                        className={activeClass(selectedLabel === label.name)}
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          selectLabel(label.name);
                        }}
                      >
                        <span
                          className="badge"
                          style={{ backgroundColor: label.color }}
                        >
                          {label.name}
                        </span>
                      </a>
                    </li>
                  ))}
                </>
              )}
              {data.task_lists.length > 0 && (
                <>
                  <li>
                    <hr className="dropdown-divider" />
                  </li>
                  <li>
                    <h6 className="dropdown-header">
                      {t('views.googleLists')}
                    </h6>
                  </li>
                  {data.task_lists.map((list) => (
                    <li key={list.list_id}>
                      <a
                        className={activeClass(selectedList === list.list_id)}
                        href="#"
                        onClick={(event) => {
                          event.preventDefault();
                          selectList(list.list_id);
                        }}
                      >
                        <i className="bi bi-folder" /> {list.title}
                      </a>
                    </li>
                  ))}
                </>
              )}
            </Dropdown>

            {/* Secondary label filter — client-side only */}
            {(selectedLabel || isSpecialView) && (
              <SecondaryLabelDropdown
                labels={data.labels}
                secondaryLabel={secondaryLabel}
              />
            )}

            {/* Ordering dropdown */}
            <Dropdown
              label={
                <>
                  <i className="bi bi-sort-down" />{' '}
                  {t(
                    `order.${
                      ORDER_OPTIONS.find((o) => o.key === orderBy)?.labelKey ??
                      'orderAsc'
                    }`,
                  )}
                </>
              }
              buttonClassName={TOGGLE_CLASS}
            >
              {ORDER_OPTIONS.map((option, index) => (
                <Fragment key={option.key}>
                  {(index === 2 || index === 4 || index === 6) && (
                    <li>
                      <hr className="dropdown-divider" />
                    </li>
                  )}
                  <li>
                    <a
                      className={activeClass(orderBy === option.key)}
                      href="#"
                      onClick={(event) => {
                        event.preventDefault();
                        changeOrder(option.key);
                      }}
                    >
                      <i className={`bi bi-${option.icon}`} />{' '}
                      {t(`order.${option.labelKey}`)}
                    </a>
                  </li>
                </Fragment>
              ))}
            </Dropdown>

            {/* Active-filter chips — one .ui-chip per set param, ×
                clears just that param (URL stays source of truth). */}
            {filterChips.length > 0 && (
              <div
                className="filter-chips"
                role="group"
                aria-label={t('filters.active')}
              >
                {filterChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className="ui-chip active"
                    title={t('filters.remove')}
                    aria-label={t('filters.remove')}
                    onClick={() => clearFilter(chip.key)}
                  >
                    {chip.label} <i className="bi bi-x-lg" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="ms-auto d-flex flex-row align-items-center gap-2">
          <Link
            to="/search"
            className="btn btn-outline-light btn-sm ui-nav-toggle"
            title={t('menu.searchTasks')}
          >
            <i className="bi bi-search" />
          </Link>
          <BurgerMenu items={burgerItems} />
        </div>
      </div>
    </nav>
  );
}

export default TaskNavBar;
