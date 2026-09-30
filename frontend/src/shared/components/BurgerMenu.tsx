import { useEffect, useRef, useState } from 'react';
import './BurgerMenu.css';

/**
 * React port of django_apps/templates/components/burger_menu.html.
 *
 * Items mirror the `burger_menu_items` dicts that Django views build:
 * `label`, `url`, `icon` (Bootstrap Icons name), `btn_class`
 * (default `btn-light`). The template's string `onclick` becomes a
 * real `onClick` callback here. Items with neither `url` nor
 * `onClick` are skipped, matching the template.
 */
export interface BurgerMenuItem {
  label: string;
  url?: string;
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
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close the menu when clicking outside of it (like the template's
  // document-level click listener).
  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [open]);

  const visibleItems = items.filter((item) => item.url || item.onClick);

  return (
    <div className="burger-menu" ref={rootRef}>
      <button
        type="button"
        className="burger-icon"
        aria-label="Toggle menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <i className="bi bi-list" />
      </button>

      <div className={`burger-menu-items${open ? ' show' : ''}`}>
        {visibleItems.map((item) =>
          item.url ? (
            <a
              key={item.label}
              href={item.url}
              className={itemClass(item)}
              onClick={() => setOpen(false)}
            >
              <ItemIcon icon={item.icon} />
              {item.label}
            </a>
          ) : (
            <button
              key={item.label}
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
      </div>
    </div>
  );
}

export default BurgerMenu;
