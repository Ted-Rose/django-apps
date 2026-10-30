import type { ReactNode } from 'react';
import { BurgerMenu, type BurgerMenuItem } from './BurgerMenu';

/**
 * Secondary-page navbar — deduplicates the copy-pasted `<nav>` block
 * from the non-dashboard routes (tasks Archived/Trash/Search/Stats/
 * Labels, notes NoteDetail/Categories). Markup is pixel-equivalent:
 * the inline styles moved to `.app-navbar` in shared/ui.css, and the
 * left group keeps `d-flex align-items-center gap-1 flex-wrap
 * flex-grow-1` so callers drop in their back button, brand link and
 * dropdowns unchanged. `variant` maps to the `bg-*` color — tasks
 * uses 'primary', notes 'dark' (must never read as tasks) and the
 * tasks trash 'danger'. The burger menu (with language switcher)
 * always renders at the right edge after `actions`.
 */
interface PageNavBarProps {
  variant: 'primary' | 'dark' | 'danger';
  /** Burger menu items — same shape the routes build today. */
  burgerItems: BurgerMenuItem[];
  /** Left slot: back button, brand link, filter dropdowns. */
  children?: ReactNode;
  /** Right slot before the burger menu (e.g. the search button). */
  actions?: ReactNode;
}

export function PageNavBar({
  variant,
  burgerItems,
  children,
  actions,
}: PageNavBarProps) {
  const navClass =
    'app-navbar navbar navbar-expand-lg navbar-dark bg-' + variant;
  return (
    <nav className={navClass}>
      <div className="container-fluid">
        <div className="d-flex align-items-center gap-1 flex-wrap flex-grow-1">
          {children}
        </div>
        <div className="ms-auto d-flex flex-row align-items-center gap-2">
          {actions}
          <BurgerMenu items={burgerItems} />
        </div>
      </div>
    </nav>
  );
}

export default PageNavBar;
