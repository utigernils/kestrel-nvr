import { Activity, History, LayoutGrid, Settings, Video, type LucideIcon } from 'lucide-react';
import type { Key } from '../../i18n';

export interface NavItem { path: string; label: Key; Icon: LucideIcon }

export const NAV_ITEMS: NavItem[] = [
  { path: '/live', label: 'nav.live', Icon: Video },
  { path: '/events', label: 'nav.events', Icon: LayoutGrid },
  { path: '/rec', label: 'nav.recordings', Icon: History },
  { path: '/system', label: 'nav.system', Icon: Activity },
  { path: '/settings', label: 'nav.settings', Icon: Settings },
];
