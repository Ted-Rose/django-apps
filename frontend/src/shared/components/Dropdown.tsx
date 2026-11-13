import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * Minimal Bootstrap-style dropdown (`dropdown` / `dropdown-toggle` /
 * `dropdown-menu`) implemented in React — the SPA shell does not load
 * bootstrap.bundle.js, so `data-bs-toggle` attributes would be inert.
 * Mirrors the markup the Django templates emit so the same CSS applies.
 *
 * Children are the `<li>` elements of the menu (`dropdown-item` links,
 * `dropdown-header`, `dropdown-divider`). Clicking any `.dropdown-item`
 * inside the menu closes it; clicking outside closes it too (same
 * pattern as BurgerMenu).
 */
interface DropdownProps {
  /** Toggle button content (icon + label). */
  label: ReactNode;
  /**
   * `id` for the toggle button — lets a form `<label htmlFor>`
   * associate with it (buttons are labelable elements).
   */
  buttonId?: string;
  /**
   * Full class override for the toggle button — replaces the default
   * navbar-style `btn btn-outline-light btn-sm dropdown-toggle`
   * (note that default also carries the caret). Use e.g.
   * `btn btn-sm btn-link text-muted` for the card three-dots menus.
   */
  buttonClassName?: string;
  /** Inline style for the toggle button (templates use small padding). */
  buttonStyle?: CSSProperties;
  /** Accessible name — needed when `label` is only an icon. */
  ariaLabel?: string;
  /** Extra classes for the `<ul>` menu (e.g. `dropdown-menu-end`). */
  menuClassName?: string;
  /**
   * `role` for the `<ul>` + matching `aria-haspopup` on the toggle.
   * Menus of actions stay `'menu'` (the default); select-like
   * pickers should pass `'listbox'` and give items `role="option"`.
   */
  menuRole?: 'menu' | 'listbox';
  /**
   * Inline style for the `<ul>` menu — the finance SPA uses
   * `max-height`/`overflow-y` to scroll long option lists.
   */
  menuStyle?: CSSProperties;
  children: ReactNode;
}

export function Dropdown({
  label,
  buttonId,
  buttonClassName = '',
  buttonStyle,
  ariaLabel,
  menuClassName = '',
  menuRole = 'menu',
  menuStyle,
  children,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        // A <label htmlFor={buttonId}> click also fires an
        // activation click on the toggle — ignoring it here lets
        // the label mirror the toggle instead of only closing.
        const label = (event.target as HTMLElement).closest('label');
        if (buttonId && label?.htmlFor === buttonId) return;
        setOpen(false);
      }
    };
    // Escape closes the menu only. The capture-phase listener +
    // stopPropagation keeps it from also reaching Escape handlers
    // bound on document by the surrounding UI (e.g. the rule
    // drawer's close-on-Escape).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('click', onDocumentClick);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, buttonId]);

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        id={buttonId}
        className={
          buttonClassName || 'btn btn-outline-light btn-sm dropdown-toggle'
        }
        type="button"
        style={buttonStyle}
        aria-expanded={open}
        aria-haspopup={menuRole}
        aria-label={ariaLabel}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {label}
      </button>
      <ul
        role={menuRole}
        className={(
          `dropdown-menu ${menuClassName}` + (open ? ' show' : '')
        ).trim()}
        style={menuStyle}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('.dropdown-item')) {
            setOpen(false);
          }
        }}
      >
        {children}
      </ul>
    </div>
  );
}

export default Dropdown;
