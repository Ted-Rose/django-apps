import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageNavBar } from './PageNavBar';
import type { BurgerMenuItem } from './BurgerMenu';

const items: BurgerMenuItem[] = [
  { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
];

describe('PageNavBar', () => {
  it('renders the variant class, slots and the burger menu', () => {
    render(
      <PageNavBar
        variant="danger"
        burgerItems={items}
        actions={<a href="/search">Search</a>}
      >
        <span>Back</span>
      </PageNavBar>,
    );

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveClass(
      'app-navbar',
      'navbar',
      'navbar-expand-lg',
      'navbar-dark',
      'bg-danger',
    );
    expect(screen.getByText('Back')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute(
      'href',
      '/search',
    );
    // Burger menu (and its language switcher) still render.
    expect(
      screen.getByRole('button', { name: 'Toggle menu' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('maps primary and dark variants onto bg-* classes', () => {
    const { rerender } = render(
      <PageNavBar variant="primary" burgerItems={items} />,
    );
    expect(screen.getByRole('navigation')).toHaveClass('bg-primary');

    rerender(<PageNavBar variant="dark" burgerItems={items} />);
    expect(screen.getByRole('navigation')).toHaveClass('bg-dark');
  });
});
