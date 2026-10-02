import { useTranslation } from 'react-i18next';
import NavBar from '../../shared/components/NavBar';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';

/**
 * React port of gmail.html's navbar + burger_menu_items — brand
 * 'Gmail to Audio' with Home / Tasks / Logout entries. All three are
 * `url` anchors (full-page navigations out of the SPA), mirroring
 * the template view's burger_menu_items context.
 */
export function GmailNavBar() {
  const { t } = useTranslation('gmail');
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const items: BurgerMenuItem[] = [
    {
      label: t('common:common.home'),
      url: '/',
      icon: 'house',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.tasks'),
      url: '/tasks/',
      icon: 'check2-square',
      btn_class: 'btn-light',
    },
    {
      label: t('common:common.logout', { user }),
      url: '/admin/logout/',
      icon: 'box-arrow-right',
      btn_class: 'btn-outline-light',
    },
  ];

  return <NavBar title={t('nav.title')} items={items} />;
}

export default GmailNavBar;
