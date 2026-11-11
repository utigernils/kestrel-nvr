import { NavLink } from 'react-router-dom';
import { LogOut, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { t } from '../../i18n';
import { BrandMark } from './Brand';
import { NAV_ITEMS } from './navItems';

interface NavSidebarProps { pendingRequests: number; version: string }

/** Navigation des Levin-Themes: Seitenleiste am Rechner, Leiste unten auf dem Handy. */
export function NavSidebar({ pendingRequests, version }: NavSidebarProps) {
  const { user, isAdmin, logout } = useAuth();
  return (
    <nav className="sidebar" aria-label={t('nav.main')}>
      <div className="sidebar__brand">
        <BrandMark size={22} />
        <span>Kestrel NVR</span>
      </div>
      <ul className="sidebar__list">
        {NAV_ITEMS.map(({ path, label, Icon }) => (
          <li key={path}>
            <NavLink to={path} className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{t(label)}</span>
              {path === '/settings' && pendingRequests > 0 && <b className="sidebar__badge">{pendingRequests}</b>}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="sidebar__foot">
        <NavLink to="/settings/account" className="sidebar__user" aria-label={t('nav.account')}>
          <UserRound size={18} strokeWidth={1.8} />
          <span>
            <b>{user?.username}</b>
            <small>{t(isAdmin ? 'role.admin' : 'role.viewer')}</small>
          </span>
        </NavLink>
        <button className="sidebar__logout" onClick={() => { void logout(); }} aria-label={t('nav.logout')} title={t('nav.logout')}><LogOut size={17} /></button>
      </div>
      <div className="sidebar__ver">{t('nav.version', { version })}</div>
    </nav>
  );
}
