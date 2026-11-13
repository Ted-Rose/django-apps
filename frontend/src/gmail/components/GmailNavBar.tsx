import { useTranslation } from 'react-i18next';
import NavBar from '../../shared/components/NavBar';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import { useAuthMenuItem } from '../../shared/components/useAuthMenuItem';

/**
 * React port of gmail.html's navbar + burger_menu_items — brand
 * 'Gmail to Audio' with Home / Tasks / auth (Login·Logout) entries.
 * All are `url` anchors (full-page navigations out of the SPA),
 * mirroring the template view's burger_menu_items context.
 */
export function GmailNavBar() {
  const { t } = useTranslation('gmail');
  const authItem = useAuthMenuItem();

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
    authItem,
  ];

  return <NavBar title={t('nav.title')} items={items} />;
}

export default GmailNavBar;
