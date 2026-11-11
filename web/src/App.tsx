import { lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { Loader } from './components/ui/Loader';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './features/auth/LoginPage';
import { t } from './i18n';

// Jede Ansicht ist ein eigenes Paket und wird erst beim Oeffnen geladen.
const pages = {
  live: () => import('./features/live/LivePage'),
  events: () => import('./features/events/EventsPage'),
  rec: () => import('./features/recordings/RecordingsPage'),
  system: () => import('./features/system/SystemPage'),
  settings: () => import('./features/settings/SettingsPage'),
};
const LivePage = lazy(pages.live);
const EventsPage = lazy(pages.events);
const RecordingsPage = lazy(pages.rec);
const SystemPage = lazy(pages.system);
const SettingsPage = lazy(pages.settings);

export default function App() {
  const { status, refresh } = useAuth();

  // Nach der Anmeldung die uebrigen Ansichten im Leerlauf vorladen: dann zeigt ein Seitenwechsel
  // keinen Lade-Platzhalter, sondern direkt den Uebergang.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const timer = window.setTimeout(() => { Object.values(pages).forEach(load => { void load().catch(() => undefined); }); }, 1200);
    return () => window.clearTimeout(timer);
  }, [status]);

  if (status === 'loading') return <div className="center-screen"><Loader label={t('app.starting')} /></div>;
  if (status === 'offline') {
    return (
      <div className="center-screen">
        <div className="empty">
          <h3>{t('app.offline')}</h3>
          <button className="btn btn--soft" onClick={() => { void refresh(); }}>{t('app.retry')}</button>
        </div>
      </div>
    );
  }
  if (status !== 'authenticated') return <LoginPage setup={status === 'setup'} />;

  return (
    <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/live" replace />} />
          <Route path="live/:cam?" element={<LivePage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="rec/:cam?/:ts?" element={<RecordingsPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="settings/:tab?" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/live" replace />} />
        </Route>
    </Routes>
  );
}
