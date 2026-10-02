import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import i18n from 'i18next';
import { BurgerMenu, type BurgerMenuItem } from './BurgerMenu';
import NavBar from './NavBar';

const items: BurgerMenuItem[] = [
  { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
  {
    label: 'Do thing',
    icon: 'gear',
    btn_class: 'btn-primary',
    onClick: () => {},
  },
];

describe('BurgerMenu', () => {
  it('renders url items as links and callback items as buttons', () => {
    const { container } = render(<BurgerMenu items={items} />);

    const link = screen.getByRole('link', { name: /Home/ });
    expect(link).toHaveAttribute('href', '/');
    expect(link.querySelector('.bi-house')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /Do thing/ }),
    ).toBeInTheDocument();
    // Collapsed by default.
    expect(container.querySelector('.burger-menu-items')).not.toHaveClass(
      'show',
    );
  });

  it('toggles the menu and fires item callbacks', () => {
    const onClick = vi.fn();
    const { container } = render(
      <BurgerMenu items={[{ label: 'Do thing', onClick }]} />,
    );
    const menu = container.querySelector('.burger-menu-items')!;

    fireEvent.click(screen.getByRole('button', { name: 'Toggle menu' }));
    expect(menu).toHaveClass('show');

    fireEvent.click(screen.getByRole('button', { name: /Do thing/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(menu).not.toHaveClass('show');
  });

  it('renders the language switcher inside the menu items', () => {
    const { container } = render(<BurgerMenu items={items} />);
    const menu = container.querySelector('.burger-menu-items')!;
    expect(
      within(menu as HTMLElement).getByRole('button', { name: 'EN' }),
    ).toBeInTheDocument();
    expect(
      within(menu as HTMLElement).getByRole('button', { name: 'LV' }),
    ).toBeInTheDocument();
  });
});

describe('NavBar', () => {
  it('renders the brand, title, user and burger items', () => {
    render(<NavBar title="Tasks" user="tedis" items={items} />);

    const nav = screen.getByRole('navigation');
    expect(nav).toHaveClass('navbar-dark', 'bg-primary');
    expect(screen.getByRole('link', { name: /Tedis's Tools/ })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByText('Tasks')).toBeInTheDocument();
    expect(screen.getByText('tedis')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('renders chrome in Latvian when the language is lv', async () => {
    await i18n.changeLanguage('lv');
    try {
      render(<NavBar title="Uzdevumi" user="tedis" items={items} />);
      expect(
        screen.getByRole('button', { name: 'Pārslēgt izvēlni' }),
      ).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});
