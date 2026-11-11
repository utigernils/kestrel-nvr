import { useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, History, Maximize, ScanSearch, VideoOff } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Empty } from '../../components/ui/Empty';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';
import { usePrefs } from '../../context/PrefsContext';
import { usePolling } from '../../hooks/usePolling';
import { t } from '../../i18n';
import { CameraTile } from './CameraTile';

export default function LivePage() {
  const { cam } = useParams();
  const navigate = useNavigate();
  const { showBoxes, setShowBoxes } = usePrefs();
  const { data: cameras, loading } = usePolling(useCallback(signal => api.cameras.list(signal), []), 2000);

  if (loading && !cameras) return <Loader />;
  const all = cameras ?? [];
  const single = cam ? all.find(c => c.name === cam) : undefined;
  const list = single ? [single] : all;

  const fullscreen = () => {
    const el = document.querySelector('.tile--focused');
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el?.requestFullscreen?.();
  };

  return (
    <>
      <PageHeader title={single ? single.name : t('nav.live')} subtitle={single ? single.host : t('live.camerasOnline', { online: all.filter(c => c.state === 'online').length, total: all.length })}>
        {single && <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={() => navigate('/live')}>{t('live.all')}</Button>}
        {single && <Button icon={<History size={16} />} onClick={() => navigate(`/rec/${single.name}`)}>{t('nav.recordings')}</Button>}
        {single && <Button icon={<Maximize size={16} />} onClick={fullscreen} aria-label={t('common.fullscreen')} />}
        <Button icon={<ScanSearch size={16} />} active={showBoxes} onClick={() => setShowBoxes(!showBoxes)}>{t('common.boxes')}</Button>
      </PageHeader>
      {all.length === 0 ? (
        <Empty icon={<VideoOff size={34} />} title={t('live.noCamera')}>
          <Link className="btn btn--primary" to="/settings/cameras">{t('live.addCamera')}</Link>
        </Empty>
      ) : (
        <div className={`tiles ${single ? 'tiles--single' : ''} ${list.length === 1 ? 'tiles--one' : ''}`}>
          {list.map(c => (
            <CameraTile key={c.name} camera={c} maxFps={single || list.length === 1 ? 0 : 6} showBoxes={showBoxes} focused={!!single || list.length === 1}
                        onOpen={single ? undefined : () => navigate(`/live/${c.name}`)} />
          ))}
        </div>
      )}
    </>
  );
}
