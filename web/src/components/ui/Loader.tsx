import LatticeLoader from '../reactbits/LatticeLoader/LatticeLoader';
import { usePrefs } from '../../context/PrefsContext';
import { t } from '../../i18n';

export function Loader({ label }: { label?: string }) {
  const { theme, palette: p } = usePrefs();
  label ??= t('app.loading');
  return (
    <div className="loader" role="status">
      {theme === 'kestrel'
        ? <LatticeLoader label={label} color={p.text} cellSize={7} gap={3} fontSize={13} />
        : <><i className="spinner" aria-hidden="true" /><span className="muted">{label}</span></>}
    </div>
  );
}
