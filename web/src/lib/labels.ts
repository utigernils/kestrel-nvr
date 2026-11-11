import { tMaybe } from '../i18n';

const LABEL_COLOR: Record<string, string> = {
  person: '#fb7185', car: '#38bdf8', truck: '#818cf8', bus: '#a78bfa', bicycle: '#4ade80',
  motorcycle: '#2dd4bf', cat: '#fbbf24', dog: '#fb923c', bird: '#facc15',
};

export const COMMON_LABELS = [
  'person', 'bicycle', 'car', 'motorcycle', 'bus', 'truck', 'cat', 'dog', 'bird', 'horse', 'backpack',
  'handbag', 'suitcase',
];

/** Name einer Objektklasse in der gewählten Sprache. */
export const labelName = (l: string): string => tMaybe(`label.${l}`, l);

export function labelColor(l: string): string {
  if (LABEL_COLOR[l]) return LABEL_COLOR[l];
  let h = 0;
  for (const c of l) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h},75%,65%)`;
}
