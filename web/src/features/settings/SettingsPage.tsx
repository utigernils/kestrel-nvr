import { useNavigate, useParams } from 'react-router-dom';
import { PageTransition } from '../../components/layout/PageTransition';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../context/AuthContext';
import { t, type Key } from '../../i18n';
import { AccountSection } from './AccountSection';
import { AppearanceSection } from './AppearanceSection';
import { CamerasSection } from './CamerasSection';
import { ChangelogSection } from './ChangelogSection';
import { DetectionSection } from './DetectionSection';
import { HomeAssistantSection } from './HomeAssistantSection';
import { StorageSection } from './StorageSection';
import { UsersSection } from './UsersSection';

const TABS = [
  { value: 'cameras', label: 'set.tab.cameras', admin: true },
  { value: 'storage', label: 'set.tab.storage', admin: true },
  { value: 'detection', label: 'set.tab.detection', admin: true },
  { value: 'users', label: 'set.tab.users', admin: true },
  { value: 'ha', label: 'set.tab.ha', admin: true },
  { value: 'appearance', label: 'set.tab.appearance', admin: false },
  { value: 'account', label: 'set.tab.account', admin: false },
  { value: 'changelog', label: 'set.tab.changelog', admin: false },
] as const satisfies readonly { value: string; label: Key; admin: boolean }[];
type Tab = (typeof TABS)[number]['value'];

export default function SettingsPage() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const tabs = TABS.filter(x => isAdmin || !x.admin);
  const active: Tab = tabs.some(x => x.value === tab) ? (tab as Tab) : tabs[0].value;
  return (
    <>
      <PageHeader title={t('nav.settings')} subtitle={isAdmin ? undefined : t('set.adminOnly')} />
      <div className="tabs" role="tablist">
        {tabs.map(x => (
          <button key={x.value} role="tab" aria-selected={x.value === active} className={`tab ${x.value === active ? 'is-on' : ''}`}
                  onClick={() => navigate(`/settings/${x.value}`)}>{t(x.label)}</button>
        ))}
      </div>
      <PageTransition id={active}>
        {active === 'cameras' && <CamerasSection />}
        {active === 'storage' && <StorageSection />}
        {active === 'detection' && <DetectionSection />}
        {active === 'users' && <UsersSection />}
        {active === 'ha' && <HomeAssistantSection />}
        {active === 'appearance' && <AppearanceSection />}
        {active === 'account' && <AccountSection />}
        {active === 'changelog' && <ChangelogSection />}
      </PageTransition>
    </>
  );
}
