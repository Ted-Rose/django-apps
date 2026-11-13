import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import NavBar from '../../shared/components/NavBar';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import { useAuthMenuItem } from '../../shared/components/useAuthMenuItem';

/**
 * React port of finance/views.py `_burger_menu_items` — the shared
 * NavBar plus a burger menu listing the same entries the template
 * UI shows, followed by a `.fin-tabs` pill tab bar that keeps the
 * six primary sections visible (the burger menu stays for Home,
 * Connect Bank and Logout).
 *
 * In-app entries use `to` (react-router Links — no page reload).
 * `url` entries render ShellLink: Home (`/`) is a shell path and
 * client-navigates; only Logout (`/admin/logout/`) is a true
 * document exit to a Django route outside the shell.
 */
export function FinanceNavBar() {
  const { t } = useTranslation('finance');
  const authItem = useAuthMenuItem();
  const tabsRef = useRef<HTMLDivElement>(null);

  // Every route mounts a fresh nav bar, so the scrollable tab
  // strip resets to the start on each navigation — re-center the
  // active tab after mount.
  useEffect(() => {
    tabsRef.current
      ?.querySelector('a.active')
      ?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, []);

  const items: BurgerMenuItem[] = [
    {
      label: t('common:common.home'),
      url: '/',
      icon: 'house',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.connectBank'),
      to: '/connect',
      icon: 'bank',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.categories'),
      to: '/categories',
      icon: 'pie-chart',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.transactions'),
      to: '/transactions',
      icon: 'arrow-left-right',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.balances'),
      to: '/balances',
      icon: 'cash-coin',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.limits'),
      to: '/limits',
      icon: 'speedometer2',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.rules'),
      to: '/rules',
      icon: 'funnel',
      btn_class: 'btn-light',
    },
    {
      label: t('nav.accounts'),
      to: '/accounts',
      icon: 'wallet2',
      btn_class: 'btn-light',
    },
    authItem,
  ];

  const tabs = [
    { to: '/categories', label: t('nav.categories') },
    { to: '/transactions', label: t('nav.transactions') },
    { to: '/balances', label: t('nav.balances') },
    { to: '/limits', label: t('nav.limits') },
    { to: '/rules', label: t('nav.rules') },
    { to: '/accounts', label: t('nav.accounts') },
  ];

  return (
    <>
      <NavBar title={t('nav.title')} items={items} />
      <div className="fin-tabs">
        <div className="container fin-tabs-inner" ref={tabsRef}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>
    </>
  );
}

export default FinanceNavBar;
