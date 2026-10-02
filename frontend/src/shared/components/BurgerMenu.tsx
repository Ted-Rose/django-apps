import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LanguageSwitcher from './LanguageSwitcher';
import './BurgerMenu.css';

/**
 * React port of django_apps/templates/components/burger_menu.html.
 *
 * Items mirror the `burger_menu_items` dicts that Django views build:
 * `label`, `url`, `icon` (Bootstrap Icons name), `btn_class`
 * (default `btn-light`). The template's string `onclick` becomes a
 * real `onClick` callback here. Items with neither `url`, `to` nor
 * `onClick` are skipped, matching the template.
 *
 * `url` renders a plain <a> (full-page navigation out of the SPA —
 * e.g. Home or /admin/logout/); `to` renders a react-router <Link>
 * for in-SPA navigation (added in finance Stage 1).
 *
 * The language switcher lives inside the items container: on desktop
 * it renders inline with the menu items, on mobile it collapses into
 * the burger dropdown instead of taking up permanent navbar space.
 */
export interface BurgerMenuItem {
  label: string;
  url?: string;
  to?: string;
  icon?: string;
  btn_class?: string;
  onClick?: () => void;
}

interface BurgerMenuProps {
  items: BurgerMenuItem[];
}

function itemClass(item: BurgerMenuItem): string {
  return `btn btn-sm ${item.btn_class ?? 'btn-light'}`;
}

function ItemIcon({ icon }: { icon?: string }) {
  if (!icon) return null;
  return <i className={`bi bi-${icon}`} />;
}

export function BurgerMenu({ items }: BurgerMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close the menu when clicking outside of it (like the template's
  // document-level click listener) or pressing Escape — focus returns
  // to the toggle button.
  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const visibleItems = items.filter(
    (item) => item.url || item.to || item.onClick,
  );

  return (
    <div className="burger-menu" ref={rootRef}>
      <button
        type="button"
        className="burger-icon"
        aria-label={t('burgerMenu.toggle')}
        aria-expanded={open}
        ref={toggleRef}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <i className="bi bi-list" />
      </button>

      <div className={`burger-menu-items${open ? ' show' : ''}`}>
        {visibleItems.map((item, index) =>
          item.url ? (
            <a
              // Labels can repeat (server-built dicts) — keep the key
              // unique with the item's index.
              key={`${item.label}-${index}`}
              href={item.url}
              className={itemClass(item)}
              onClick={() => setOpen(false)}
            >
              <ItemIcon icon={item.icon} />
              {item.label}
            </a>
          ) : item.to ? (
            <Link
              key={`${item.label}-${index}`}
              to={item.to}
              className={itemClass(item)}
              onClick={() => setOpen(false)}
            >
              <ItemIcon icon={item.icon} />
              {item.label}
            </Link>
          ) : (
            <button
              key={`${item.label}-${index}`}
              type="button"
              className={itemClass(item)}
              onClick={() => {
                setOpen(false);
                item.onClick?.();
              }}
            >
              <ItemIcon icon={item.icon} />
              {item.label}
            </button>
          ),
        )}
        {visibleItems.length > 0 && <hr className="burger-menu-divider" />}
        <LanguageSwitcher />
      </div>
    </div>
  );
}

export default BurgerMenu;
