import { Link, useParams } from 'react-router-dom';
import NavBar from '../../shared/components/NavBar';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';

/**
 * Graceful placeholder for the routes the `/tasks/app/<subpath>/`
 * catch-all already serves but Stage 2 does not implement yet
 * (search, task detail, archived, trash land in Stage 5; starred and
 * overdue reuse the dashboard endpoint later). Points at the working
 * template UI meanwhile.
 */
interface StubPageProps {
  title: string;
  /** Path under /tasks/ on the template UI, e.g. 'search/'. */
  templatePath: string;
  icon?: string;
}

export function StubPage({ title, templatePath, icon }: StubPageProps) {
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const items: BurgerMenuItem[] = [
    { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
    {
      label: 'Tasks Dashboard',
      url: '/tasks/app/',
      icon: 'list-task',
      btn_class: 'btn-light',
    },
    {
      label: 'Template UI',
      url: '/tasks/',
      icon: 'card-list',
      btn_class: 'btn-light',
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
      <NavBar title="Tasks" user={user} items={items} />
      <div className="container py-5">
        <div className="alert alert-info text-center py-5">
          <i className={`bi ${icon ?? 'bi-tools'} fs-1 d-block mb-3`} />
          <h5>{title}</h5>
          <p className="mb-3">
            This page is being rebuilt in React — it arrives in a later stage.
            The template version still works:
          </p>
          <a href={`/tasks/${templatePath}`} className="btn btn-primary">
            <i className="bi bi-box-arrow-up-right" /> Open {title} in the
            template UI
          </a>
          <p className="mb-0 mt-3">
            <Link to="/">← Back to the React dashboard</Link>
          </p>
        </div>
      </div>
    </>
  );
}

export function TaskDetailStub() {
  const { taskId } = useParams();
  return (
    <StubPage
      title="Task Detail"
      templatePath={`task/${taskId ?? ''}/`}
      icon="bi-card-text"
    />
  );
}

export default StubPage;
