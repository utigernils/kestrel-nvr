import { labelColor, labelName } from '../../lib/labels';

/** Objektname in normaler Schriftfarbe; die Farbe der Klasse steckt nur im Punkt davor. */
export function LabelName({ label }: { label: string }) {
  return (
    <span className="label-name">
      <i className="label-name__dot" style={{ background: labelColor(label) }} aria-hidden="true" />
      {labelName(label)}
    </span>
  );
}
