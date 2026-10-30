import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BurgerMenu,
  type BurgerMenuItem,
} from '../../shared/components/BurgerMenu';
import Dropdown from '../../shared/components/Dropdown';
import type { NotesDashboardOut } from '../api';
import { flattenCategoryTree } from '../categories';

/**
 * The notes navbar — deliberately `navbar-dark bg-dark` (never
 * bg-primary) so the user always knows they're in notes, not tasks.
 * Holds the category-tree dropdown (All notes · Inbox · the tree
 * depth-indented with subtree counts · manage link), an ordering
 * dropdown, a search affordance and the burger menu.
 *
 * Filter behavior mirrors the tasks navbar: the URL is the source
 * of truth — `?category=<id>` drives the API's subtree filter, the
 * sentinel `?category=inbox` filters uncategorized notes
 * client-side (the API has no uncategorized-id), `?q=` goes to the
 * API's title/body search, `?order=` picks the ordering.
 */
export const INBOX_FILTER = 'inbox';

const ORDER_OPTIONS: { key: string; icon: string; labelKey: string }[] = [
  { key: 'created_desc', icon: 'sort-numeric-down', labelKey: 'newest' },
  { key: 'created_asc', icon: 'sort-numeric-up', labelKey: 'oldest' },
  { key: 'order_asc', icon: 'sort-alpha-up', labelKey: 'orderAsc' },
  { key: 'order_desc', icon: 'sort-alpha-down', labelKey: 'orderDesc' },
  { key: 'due_asc', icon: 'calendar-event', labelKey: 'dueAsc' },
  { key: 'due_desc', icon: 'calendar-event', labelKey: 'dueDesc' },
];

interface NotesNavBarProps {
  /** Dashboard response once loaded; filters hide while loading. */
  data?: NotesDashboardOut;
  burgerItems: BurgerMenuItem[];
}

function activeClass(active: boolean): string {
  return `dropdown-item${active ? ' active' : ''}`;
}

export function NotesNavBar({ data, burgerItems }: NotesNavBarProps) {
  const { t } = useTranslation('notes');
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedCategory = searchParams.get('category');
  const q = searchParams.get('q') ?? '';
  const orderParam = searchParams.get('order');
  const orderBy = orderParam ?? data?.order_by ?? 'created_desc';
  const categories = data?.categories ?? [];

  const [searchOpen, setSearchOpen] = useState(Boolean(q));
  const [searchDraft, setSearchDraft] = useState(q);
  // Keep the draft in sync when the URL's q changes (e.g. cleared
  // via the back button) — but don't clobber mid-typing.
  useEffect(() => {
    setSearchDraft(q);
    if (q) setSearchOpen(true);
  }, [q]);

  /** Set/replace `?category=`; the inbox sentinel stays a literal. */
  const selectCategory = (category: string | null) => {
    const params = new URLSearchParams(searchParams);
    params.delete('category');
    if (category) params.set('category', category);
    setSearchParams(params);
  };

  /** Keep other params, replace `?order=` (empty restores default). */
  const changeOrder = (orderKey: string) => {
    const params = new URLSearchParams(searchParams);
    if (orderKey) {
      params.set('order', orderKey);
    } else {
      params.delete('order');
    }
    setSearchParams(params);
  };

  const submitSearch = () => {
    const params = new URLSearchParams(searchParams);
    const trimmed = searchDraft.trim();
    if (trimmed) {
      params.set('q', trimmed);
    } else {
      params.delete('q');
    }
    setSearchParams(params);
  };

  const selectedName =
    selectedCategory === INBOX_FILTER
      ? t('views.inbox')
      : categories.find((c) => String(c.id) === selectedCategory)?.name;

  const viewLabel = selectedCategory ? (
    <>
      <i
        className={`bi ${
          selectedCategory === INBOX_FILTER ? 'bi-inbox' : 'bi-folder'
        }`}
      />{' '}
      {selectedName ?? t('views.allNotes')}
    </>
  ) : (
    <>
      <i className="bi bi-journal-text" /> {t('views.allNotes')}
    </>
  );

  const rows = flattenCategoryTree(categories);

  const toggleClass = 'btn btn-outline-light btn-sm ui-nav-toggle';

  return (
    <nav className="app-navbar navbar navbar-expand-lg navbar-dark bg-dark">
      <div className="container-fluid">
        {data && (
          <div
            className="d-flex align-items-center gap-1 flex-wrap
              flex-grow-1"
          >
            {/* Category dropdown: All notes · Inbox · tree · manage */}
            <Dropdown
              label={viewLabel}
              buttonClassName={`${toggleClass} dropdown-toggle`}
            >
              <li>
                <a
                  className={activeClass(!selectedCategory)}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    selectCategory(null);
                  }}
                >
                  <i className="bi bi-journal-text" /> {t('views.allNotes')}
                </a>
              </li>
              <li>
                <a
                  className={activeClass(selectedCategory === INBOX_FILTER)}
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    selectCategory(INBOX_FILTER);
                  }}
                >
                  <i className="bi bi-inbox" /> {t('views.inbox')}
                </a>
              </li>
              {rows.length > 0 && (
                <li>
                  <hr className="dropdown-divider" />
                </li>
              )}
              {rows.map(({ category, depth, hasChildren }) => (
                <li key={category.id}>
                  <a
                    className={activeClass(
                      selectedCategory === String(category.id),
                    )}
                    style={{ paddingLeft: `${1 + depth * 1.25}rem` }}
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      selectCategory(String(category.id));
                    }}
                  >
                    <i
                      className={`bi ${
                        hasChildren || depth === 0 ? 'bi-folder' : 'bi-tag'
                      }`}
                    />{' '}
                    {category.name}{' '}
                    <span className="text-muted">
                      ({category.note_count ?? 0})
                    </span>
                  </a>
                </li>
              ))}
              <li>
                <hr className="dropdown-divider" />
              </li>
              <li>
                <Link className="dropdown-item" to="/categories">
                  <i className="bi bi-gear" /> {t('views.manageCategories')}
                </Link>
              </li>
            </Dropdown>

            {/* Ordering dropdown */}
            <Dropdown
              label={
                <>
                  <i className="bi bi-sort-down" />{' '}
                  {t(
                    `order.${
                      ORDER_OPTIONS.find((o) => o.key === orderBy)?.labelKey ??
                      'newest'
                    }`,
                  )}
                </>
              }
              buttonClassName={`${toggleClass} dropdown-toggle`}
            >
              {ORDER_OPTIONS.map((option, index) => (
                <Fragment key={option.key}>
                  {(index === 2 || index === 4) && (
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

            {/* Inline search — icon expands an input posting ?q= */}
            {searchOpen && (
              <form
                className="d-flex align-items-center"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSearch();
                }}
              >
                <input
                  type="search"
                  className="form-control form-control-sm notes-search-input"
                  placeholder={t('list.searchPlaceholder')}
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  aria-label={t('menu.searchNotes')}
                />
              </form>
            )}
          </div>
        )}
        <div className="ms-auto d-flex flex-row align-items-center gap-2">
          <button
            type="button"
            className={toggleClass}
            title={t('menu.searchNotes')}
            onClick={() => {
              if (searchOpen && searchDraft) {
                // Second click on the icon submits the typed query.
                submitSearch();
              } else if (searchOpen) {
                setSearchOpen(false);
                submitSearch();
              } else {
                setSearchOpen(true);
              }
            }}
          >
            <i className="bi bi-search" />
          </button>
          <BurgerMenu items={burgerItems} />
        </div>
      </div>
    </nav>
  );
}

export default NotesNavBar;
