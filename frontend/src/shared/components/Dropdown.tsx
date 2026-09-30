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
  /** Extra classes for the toggle button. */
  buttonClassName?: string;
  /** Inline style for the toggle button (templates use small padding). */
  buttonStyle?: CSSProperties;
  /** Extra classes for the `<ul>` menu (e.g. `dropdown-menu-end`). */
  menuClassName?: string;
  children: ReactNode;
}

export function Dropdown({
  label,
  buttonClassName = '',
  buttonStyle,
  menuClassName = '',
  children,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="dropdown" ref={rootRef}>
      <button
        className={`btn btn-outline-light btn-sm dropdown-toggle ${buttonClassName}`.trim()}
        type="button"
        style={buttonStyle}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {label}
      </button>
      <ul
        className={`dropdown-menu ${menuClassName}${open ? ' show' : ''}`.trim()}
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
