import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../shared/session';
import BurgerMenu from '../shared/components/BurgerMenu';
import { useAuthMenuItem } from '../shared/components/useAuthMenuItem';
import './home.css';

/**
 * The dashboard — React port of the retired home.html card grid,
 * now a route inside the unified shell at `/`. Cards navigate
 * client-side (no document reload); the Admin card is gated on
 * `is_staff` from the /api/me bootstrap. Public like before:
 * anonymous visitors see the grid and a card click bounces them
 * to login via the session gate.
 */
interface Card {
  to: string;
  icon: string;
  title: string;
  text: string;
  /** Internal client-side route vs external Django page. */
  external?: boolean;
}

export default function Home() {
  const { t } = useTranslation();
  const session = useSession();
  // Anonymous visitors get the "Login with Google" item here — `/`
  // is the only public route, so this is the one place the login
  // half of the shared auth item is reachable from a menu.
  const authItem = useAuthMenuItem();

  const cards: Card[] = [
    {
      to: '/gmail/',
      icon: 'envelope',
      title: t('common:home.emailManager'),
      text: t('common:home.emailManagerText'),
    },
    {
      to: '/twister',
      icon: 'shuffle',
      title: t('common:home.twisterGame'),
      text: t('common:home.twisterGameText'),
    },
    {
      to: '/tasks/',
      icon: 'check2-square',
      title: t('common:home.googleTasks'),
      text: t('common:home.googleTasksText'),
    },
    {
      to: '/finance/',
      icon: 'bank',
      title: t('common:home.finance'),
      text: t('common:home.financeText'),
    },
    {
      to: '/notes/',
      icon: 'journal-text',
      title: t('common:home.notes'),
      text: t('common:home.notesText'),
    },
  ];
  if (session?.is_staff) {
    // Django admin is outside the SPA — a full document load.
    cards.push({
      to: '/admin/',
      icon: 'gear',
      title: t('common:home.admin'),
      text: t('common:home.adminText'),
      external: true,
    });
  }

  return (
    <div className="home-page">
      <nav className="navbar navbar-expand-lg navbar-dark bg-primary">
        <div className="container-fluid">
          <Link className="navbar-brand" to="/">
            <i className="bi bi-house-heart" /> {t('common:nav.brand')}
          </Link>
          <div className="ms-auto">
            <BurgerMenu items={[authItem]} />
          </div>
        </div>
      </nav>

      <div className="hero-section text-center">
        <div className="container">
          <h1 className="display-4 mb-3">{t('common:home.greeting')}</h1>
          <p className="lead">{t('common:home.tagline')}</p>
        </div>
      </div>

      <div className="container pb-5">
        <div className="row g-4">
          {cards.map((card) => (
            <div className="col-md-6 col-lg-4" key={card.to}>
              {card.external ? (
                <a href={card.to} className="text-decoration-none">
                  <ToolCard card={card} />
                </a>
              ) : (
                <Link to={card.to} className="text-decoration-none">
                  <ToolCard card={card} />
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ToolCard({ card }: { card: Card }) {
  return (
    <div className="card tool-card">
      <div className="card-body text-center">
        <i className={`bi bi-${card.icon} tool-icon`} />
        <h5 className="card-title">{card.title}</h5>
        <p className="card-text">{card.text}</p>
      </div>
    </div>
  );
}
