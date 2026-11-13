import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { AppRouter } from './AppRouter';

/**
 * AppRouter re-implements `<Router basename>` around the shell's
 * single outer router (nested <Router> is forbidden in v7). These
 * tests pin the contract the apps were written against: in-app
 * absolute links resolve under the mount prefix, and
 * `useLocation().pathname` is the app-relative path.
 */

function InAppProbe() {
  const location = useLocation();
  return (
    <div>
      <span data-testid="inner-path">{location.pathname}</span>
      <Link to="/trash">trash</Link>
    </div>
  );
}

function OuterPath() {
  const location = useLocation();
  return <span data-testid="outer-path">{location.pathname}</span>;
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <OuterPath />
      <AppRouter basename="/tasks">
        <Routes>
          <Route path="/*" element={<InAppProbe />} />
        </Routes>
      </AppRouter>
    </MemoryRouter>,
  );
}

describe('AppRouter', () => {
  it('exposes the stripped app-relative pathname', () => {
    renderApp('/tasks/starred');
    expect(screen.getByTestId('inner-path')).toHaveTextContent('/starred');
  });

  it('resolves absolute in-app links against the basename', () => {
    renderApp('/tasks/starred');
    expect(screen.getByRole('link', { name: 'trash' })).toHaveAttribute(
      'href',
      '/tasks/trash',
    );
  });

  it('writes the real URL on navigation', () => {
    renderApp('/tasks/starred');
    fireEvent.click(screen.getByRole('link', { name: 'trash' }));
    // The outer history records the basename-prefixed URL while
    // the app keeps seeing only its relative path.
    expect(screen.getByTestId('outer-path')).toHaveTextContent('/tasks/trash');
    expect(screen.getByTestId('inner-path')).toHaveTextContent('/trash');
  });

  it('renders nothing outside its basename', () => {
    render(
      <MemoryRouter initialEntries={['/finance/accounts']}>
        <AppRouter basename="/tasks">
          <div>app-content</div>
        </AppRouter>
      </MemoryRouter>,
    );
    expect(screen.queryByText('app-content')).not.toBeInTheDocument();
  });
});
