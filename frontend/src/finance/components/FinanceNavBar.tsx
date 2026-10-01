import NavBar from '../../shared/components/NavBar';
import type { BurgerMenuItem } from '../../shared/components/BurgerMenu';
import useBootstrap from '../../shared/hooks/useBootstrap';

/**
 * React port of finance/views.py `_burger_menu_items` — the shared
 * NavBar plus a burger menu listing the same entries the template
 * UI shows.
 *
 * In-SPA entries use `to` (react-router Links — no page reload);
 * Home and Logout stay plain `url` anchors because both navigate
 * out of the SPA to full-page Django routes.
 */
export function FinanceNavBar() {
  const bootstrap = useBootstrap();
  const user = bootstrap.user ?? 'unknown';

  const items: BurgerMenuItem[] = [
    { label: 'Home', url: '/', icon: 'house', btn_class: 'btn-light' },
    {
      label: 'Connect Bank',
      to: '/connect',
      icon: 'bank',
      btn_class: 'btn-light',
    },
    {
      label: 'Accounts',
      to: '/accounts',
      icon: 'wallet2',
      btn_class: 'btn-light',
    },
    {
      label: 'Transactions',
      to: '/transactions',
      icon: 'arrow-left-right',
      btn_class: 'btn-light',
    },
    {
      label: 'Categories',
      to: '/categories',
      icon: 'pie-chart',
      btn_class: 'btn-light',
    },
    {
      label: 'Balances',
      to: '/balances',
      icon: 'cash-coin',
      btn_class: 'btn-light',
    },
    {
      label: 'Limits',
      to: '/limits',
      icon: 'speedometer2',
      btn_class: 'btn-light',
    },
    {
      label: 'Rules',
      to: '/rules',
      icon: 'funnel',
      btn_class: 'btn-light',
    },
    {
      label: `Logout (${user})`,
      url: '/admin/logout/',
      icon: 'box-arrow-right',
      btn_class: 'btn-outline-light',
    },
  ];

  return <NavBar title="Finance" items={items} />;
}

export default FinanceNavBar;
