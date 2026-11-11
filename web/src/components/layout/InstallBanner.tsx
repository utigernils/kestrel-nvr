import { Download, X } from 'lucide-react';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { t } from '../../i18n';
import { promptInstall, useInstallState } from '../../lib/install';
import { Button } from '../ui/Button';

/** Unaufdringlicher Hinweis auf dem Handy, solange der Browser die Installation anbietet. */
export function InstallBanner() {
  const state = useInstallState();
  const touch = useMediaQuery('(pointer: coarse)');
  const [dismissed, setDismissed] = useLocalStorage('kestrel.installDismissed', false);
  if (state !== 'available' || !touch || dismissed) return null;
  return (
    <div className="notices">
      <div className="notice notice--pair">
        <Download size={18} className="notice__icon" />
        <div className="notice__body">{t('app2.installBanner')}</div>
        <div className="row">
          <Button variant="primary" onClick={() => { void promptInstall(); }}>{t('app2.installBtn')}</Button>
          <Button variant="ghost" icon={<X size={16} />} onClick={() => setDismissed(true)} aria-label={t('app2.installLater')} />
        </div>
      </div>
    </div>
  );
}
