import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import { BurgerMenu } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';
import { actionHistory } from '../actionHistory';
import { fetchSearchTasks, type TaskOut } from '../api';
import Toasts from '../components/Toasts';
import { useSync, useToggleStar } from '../mutations';
import { formatFullDate, spaPathFromStoredUrl, truncateWords } from '../utils';
import { ErrorState } from './TaskListPage';

/**
 * React port of search.html — deliberately reshaped to the new API
 * contract (documented redesign in api.py): one `q` input instead of
 * separate title+notes fields, OR-matched across title/notes, and a
 * flat result list ordered by -updated instead of per-task-list
 * groups. `q` lives in the URL (?search?q=…) so results stay
 * shareable; typing debounces 500ms into the param like the
 * template's live search did.
 *
 * The "Back to Dashboard" button returns to `lastTasksView` (written
 * by every list page) when it points inside the SPA — same as the
 * template's localStorage trick.
 */
const SEARCH_DEBOUNCE_MS = 500;

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const trimmedQ = q.trim();
  const [draft, setDraft] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = useNavigate();

  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';
  const syncMutation = useSync();

  // Keep the input in step with URL changes (back/forward, Clear).
  useEffect(() => {
    setDraft(q);
  }, [q]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const submitDraft = (value: string) => {
    const trimmed = value.trim();
    setSearchParams(trimmed ? { q: trimmed } : {}, { replace: true });
  };

  const onInput = (value: string) => {
    setDraft(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(
      () => submitDraft(value),
      SEARCH_DEBOUNCE_MS,
    );
  };

  // NOTE: intentionally NOT under the ['dashboard', …] root — the
  // mutation hooks patch that key family as DashboardOut, which this
  // {tasks, total_results} shape is not.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['search', trimmedQ],
    queryFn: () => fetchSearchTasks(trimmedQ),
    enabled: trimmedQ.length > 0,
  });

  const backTarget =
    spaPathFromStoredUrl(
      (() => {
        try {
          return localStorage.getItem('lastTasksView');
        } catch {
          return null;
        }
      })(),
    ) ?? '/';

  const burgerItems: BurgerMenuItem[] = [
    { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
    {
      label: 'Dashboard',
      icon: 'list-task',
      btn_class: 'btn-light',
      onClick: () => navigate(backTarget),
    },
    {
      label: syncMutation.isPending ? 'Syncing…' : 'Sync Now',
      icon: 'arrow-repeat',
      btn_class: 'btn-light',
      onClick: () => syncMutation.mutate(),
    },
    {
      label: `Logout (${user})`,
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
              <i className="bi bi-arrow-left" /> Back to Dashboard
            </Link>
          </div>
          <div className="ms-auto d-flex flex-row align-items-center gap-2">
            <BurgerMenu items={burgerItems} />
          </div>
        </div>
      </nav>

      <div className="container mt-4">
        <div className="search-form">
          <h4 className="mb-3">
            <i className="bi bi-search" /> Search Tasks
            {isPending && (
              <small className="text-muted ms-2" id="search-status">
                <span className="spinner-border spinner-border-sm" />{' '}
                Searching...
              </small>
            )}
          </h4>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitDraft(draft);
            }}
          >
            <div className="row g-3">
              <div className="col-md-8">
                <label htmlFor="search-q" className="form-label">
                  Search
                </label>
                <input
                  type="text"
                  className="form-control"
                  id="search-q"
                  name="q"
                  value={draft}
                  placeholder="Search task titles and notes..."
                  onChange={(event) => onInput(event.target.value)}
                />
              </div>
              <div className="col-12">
                <button type="submit" className="btn btn-primary">
                  <i className="bi bi-search" /> Search
                </button>{' '}
                <Link to="/search" className="btn btn-secondary">
                  <i className="bi bi-x-circle" /> Clear
                </Link>
              </div>
            </div>
          </form>
        </div>

        {isError && <ErrorState error={error} onRetry={() => refetch()} />}
        {!trimmedQ ? (
          <div className="alert alert-info text-center py-5">
            <i className="bi bi-info-circle fs-1 d-block mb-3" />
            <h5>Enter search criteria</h5>
            <p className="mb-0">
              Enter a task title and/or notes to search for tasks.
            </p>
          </div>
        ) : data ? (
          data.total_results > 0 ? (
            <>
              <div className="alert alert-success">
                <i className="bi bi-check-circle" /> Found {data.total_results}{' '}
                task{data.total_results === 1 ? '' : 's'}
              </div>
              {data.tasks.map((task) => (
                <SearchResultCard key={task.task_id} task={task} />
              ))}
            </>
          ) : (
            <div className="alert alert-warning text-center py-5">
              <i className="bi bi-exclamation-triangle fs-1 d-block mb-3" />
              <h5>No tasks found</h5>
              <p className="mb-0">
                Try different search terms or check your filters.
              </p>
            </div>
          )
        ) : null}
      </div>
      <Toasts />
    </>
  );
}

function SearchResultCard({ task }: { task: TaskOut }) {
  const toggleStar = useToggleStar();
  const queryClient = useQueryClient();
  const due = formatFullDate(task.due);

  return (
    <div className="card task-card mb-2" data-task-id={task.task_id}>
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start">
          <div className="d-flex align-items-start flex-grow-1">
            <div className="flex-grow-1">
              <h5 className="card-title">
                <span
                  className={`star-btn me-1${task.is_starred ? ' starred' : ''}`}
                  role="button"
                  title={task.is_starred ? 'Unstar' : 'Star'}
                  onClick={(event) => {
                    event.stopPropagation();
                    actionHistory.recordAction({
                      type: 'TOGGLE_STAR',
                      taskId: task.task_id,
                      previousState: task.is_starred,
                    });
                    toggleStar.mutate(task.task_id, {
                      onSettled: () =>
                        // The search list is its own query root — the
                        // shared dashboard invalidation can't see it.
                        queryClient.invalidateQueries({
                          queryKey: ['search'],
                        }),
                    });
                  }}
                >
                  <i
                    className={`bi ${
                      task.is_starred ? 'bi-star-fill' : 'bi-star'
                    }`}
                  />
                </span>
                <Link to={`/task/${task.task_id}`} className="task-title-link">
                  {task.title}
                </Link>
                {task.is_archived && (
                  <span className="badge bg-secondary ms-2">Archived</span>
                )}
                {task.needs_push && (
                  <i
                    className="bi bi-cloud-arrow-up text-warning ms-1"
                    title="Pending sync to Google"
                  />
                )}
              </h5>
              {task.notes && (
                <p className="card-text text-muted">
                  {truncateWords(task.notes, 30)}
                </p>
              )}
              {(due || task.task_list) && (
                <small className="text-muted">
                  {due && (
                    <>
                      <i className="bi bi-calendar" /> Due: {due}
                    </>
                  )}
                  {task.task_list && (
                    <span
                      className="badge bg-light text-dark border ms-2"
                      title="Google task list"
                    >
                      <i className="bi bi-folder" /> {task.task_list.title}
                    </span>
                  )}
                </small>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
