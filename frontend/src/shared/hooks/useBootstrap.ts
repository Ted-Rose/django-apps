import { useMemo } from 'react';
import type { BurgerMenuItem } from '../components/BurgerMenu';

/**
 * Payload rendered by `spa_shell.html` via
 * `{{ bootstrap|json_script:"spa-bootstrap" }}`. Views pass at least
 * `user`; `burger_menu_items` and app-specific keys may be added by
 * the shell view later.
 */
export interface BootstrapPayload {
  user?: string;
  /** Stored per-user language pref ('en'/'lv') — see UserSettings. */
  language?: string;
  burger_menu_items?: BurgerMenuItem[];
  [key: string]: unknown;
}

/** Reads the `#spa-bootstrap` json_script payload once. */
export function useBootstrap(): BootstrapPayload {
  return useMemo(() => {
    const el = document.getElementById('spa-bootstrap');
    if (!el || !el.textContent) return {};
    try {
      return JSON.parse(el.textContent) as BootstrapPayload;
    } catch {
      return {};
    }
  }, []);
}

export default useBootstrap;
