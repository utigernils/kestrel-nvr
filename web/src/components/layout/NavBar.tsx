import { NavLink, useLocation } from 'react-router-dom';
import { UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { t } from '../../i18n';
import { NAV_ITEMS } from './navItems';

interface NavBarProps { pendingRequests: number }

/**
 * Navigation des Kestrel-Themes: eine deckende Leiste am unteren Rand mit matten Knoepfen in
 * den Farben der Palette - bewusst ohne Verlauf, Glanz oder Vergroesserung.
 */
export function NavBar({ pendingRequests }: NavBarProps) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const onAccount = pathname.startsWith('/settings/account');
  return (
    <nav className="navbar" aria-label={t('nav.main')}>
      <div className="navbar__panel">
        {NAV_ITEMS.map(({ path, label, Icon }) => {
          const active = pathname.startsWith(path) && !(path === '/settings' && onAccount);
          return (
            <NavLink key={path} to={path} className={`navbar__item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon size={19} strokeWidth={1.8} />
              <span className="navbar__label">{t(label)}</span>
              {path === '/settings' && pendingRequests > 0 && <b className="navbar__badge">{pendingRequests}</b>}
            </NavLink>
          );
        })}
        <i className="navbar__sep" aria-hidden="true" />
        <NavLink to="/settings/account" className={`navbar__item ${onAccount ? 'is-active' : ''}`} title={user?.username}
                 aria-label={`${t('nav.account')}: ${user?.username ?? ''}`}>
          <UserRound size={19} strokeWidth={1.8} />
          <span className="navbar__label">{user?.username ?? t('nav.account')}</span>
        </NavLink>
      </div>
    </nav>
  );
}
