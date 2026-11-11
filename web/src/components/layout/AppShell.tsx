import { Suspense, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { usePrefs } from '../../context/PrefsContext';
import { usePolling } from '../../hooks/usePolling';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { Loader } from '../ui/Loader';
import { Background } from './Background';
import { Brand } from './Brand';
import { InstallBanner } from './InstallBanner';
import { NavBar } from './NavBar';
import { NavSidebar } from './NavSidebar';
import { Notices } from './Notices';
import { PageTransition } from './PageTransition';

/** Rahmen der angemeldeten Anwendung. Kestrel: Kopfzeile und Leiste unten. Levin: Seitenleiste. */
export function AppShell() {
  const { version, isAdmin } = useAuth();
  const { theme } = usePrefs();
  const { pathname } = useLocation();

  const stats = usePolling(useCallback(signal => api.system.stats(signal), []), 10_000);
  const integ = usePolling(
    useCallback(async () => (isAdmin ? api.integrations.list() : { clients: [], pending: [] }), [isAdmin]),
    5_000, [isAdmin],
  );
  const pending = integ.data?.pending ?? [];
  const levin = theme === 'levin';
  const view = pathname.split('/')[1] || 'live';

  return (
    <>
      <Background paused={pathname.startsWith('/rec')} />
      <div className={`shell ${levin ? 'shell--sidebar' : 'shell--dock'}`}>
        {levin ? <NavSidebar pendingRequests={pending.length} version={version} /> : (
          <header className="topbar"><Brand version={version} /></header>
        )}
        <div className="shell__body">
          <Notices storage={stats.data?.storage} pending={pending} onDecided={integ.reload} />
          <InstallBanner />
          <main className="content">
            <ErrorBoundary key={view}>
              <Suspense fallback={<Loader />}>
                <PageTransition id={view}><Outlet /></PageTransition>
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
        {!levin && <NavBar pendingRequests={pending.length} />}
      </div>
    </>
  );
}
