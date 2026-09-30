import NavBar from '../shared/components/NavBar';
import type { BurgerMenuItem } from '../shared/components/BurgerMenu';
import useBootstrap from '../shared/hooks/useBootstrap';

export default function App() {
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';
  const menuItems: BurgerMenuItem[] = [
    { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
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
      <NavBar title="Tasks" user={user} items={menuItems} />
      <div className="container py-4">
        <h1 className="mb-3">Tasks — React shell</h1>
        <p>
          Signed in as <strong>{user}</strong>.
        </p>
        <p className="text-muted">
          This page is rendered by React via Vite + django-vite (strangler mount
          at <code>/tasks/app/</code>). The template UI still lives at{' '}
          <a href="/tasks/">/tasks/</a>.
        </p>
      </div>
    </>
  );
}
