import { useTranslation } from 'react-i18next';
import { BurgerMenu, type BurgerMenuItem } from './BurgerMenu';

/**
 * Shared Bootstrap navbar matching the site look
 * (`navbar-dark bg-primary`, "Tedis's Tools" brand — see
 * django_apps/templates/home.html). Burger menu items are passed via
 * props, mirroring the `burger_menu_items` context that template
 * views build. The burger menu itself holds the language switcher,
 * so it renders even when there are no items.
 */
interface NavBarProps {
  /** App/page title shown next to the brand, e.g. "Tasks". */
  title?: string;
  /** Signed-in username shown at the right edge. */
  user?: string;
  /** Burger menu items (same shape as the Django template's). */
  items?: BurgerMenuItem[];
}

export function NavBar({ title, user, items = [] }: NavBarProps) {
  const { t } = useTranslation();
  return (
    <nav className="navbar navbar-expand-lg navbar-dark bg-primary">
      <div className="container-fluid">
        <a className="navbar-brand" href="/">
          <i className="bi bi-house-heart" /> {t('nav.brand')}
        </a>
        {title && <span className="navbar-text">{title}</span>}
        <div className="ms-auto d-flex align-items-center gap-2">
          {user && <span className="navbar-text">{user}</span>}
          <BurgerMenu items={items} />
        </div>
      </div>
    </nav>
  );
}

export default NavBar;
