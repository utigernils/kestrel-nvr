import SquishSwitch from '../reactbits/SquishSwitch/SquishSwitch';
import { usePrefs } from '../../context/PrefsContext';

interface SwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}

/** Schalter. Im Kestrel-Theme mit federndem Knopf (React Bits: SquishSwitch), im Levin-Theme schlicht. */
export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  const { theme, palette: p } = usePrefs();
  return (
    <div className="switch-row">
      <span>{label}</span>
      {theme === 'kestrel' ? (
        <SquishSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={label} width={46} height={26}
                      trackColor={p.surface3} trackOnColor={p.ok} thumbColor="#ffffff" thumbOnColor="#ffffff" />
      ) : (
        <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
                className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><i /></button>
      )}
    </div>
  );
}
