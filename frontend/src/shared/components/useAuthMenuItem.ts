import { useTranslation } from 'react-i18next';

import { useSession } from '../session';
import type { BurgerMenuItem } from './BurgerMenu';

/**
 * The login/logout item that ends every app's burger menu.
 *
 * Resolved session → "Logout (user)" via Django's /admin/logout/.
 * No session — an anonymous visitor on the public `/` dashboard, or
 * a session that died between the /api/me/ bootstrap and now — →
 * "Login with Google" via /login/?next=<current path>, the same
 * target SessionGate and the API 401 `login_url` use. Both are
 * plain `url` items: auth lives on Django pages outside the shell,
 * so the click is a document navigation, not a client-side route.
 */
export function useAuthMenuItem(): BurgerMenuItem {
  const { t } = useTranslation();
  const session = useSession();

  if (!session) {
    const next = window.location.pathname + window.location.search;
    return {
      label: t('common:common.loginGoogle'),
      url: `/login/?next=${encodeURIComponent(next)}`,
      icon: 'google',
      btn_class: 'btn-warning',
    };
  }
  return {
    label: t('common:common.logout', { user: session.username }),
    url: '/admin/logout/',
    icon: 'box-arrow-right',
    btn_class: 'btn-outline-light',
  };
}
