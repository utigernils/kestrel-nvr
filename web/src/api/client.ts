import { t, tMaybe } from '../i18n';
import type {
  AuthState, Camera, CameraConfig, Config, DetectionRow, EventItem, Integrations, LiveDetections,
  MinuteIndex, ModelList, ProbeResult, Role, SettingsPatch, Stats, TimelineEntry, User,
} from './types';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized: (() => void) | null = null;
/** Wird vom AuthContext gesetzt: laeuft die Sitzung ab, geht es zurueck zur Anmeldung. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Kestrel': '1' };   // Pflicht-Header gegen CSRF
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, {
    method: opts.method ?? 'GET', headers, body, signal: opts.signal, credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized?.();
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    let code = '';
    try {
      const j = await res.json();
      const d = j.detail;
      if (typeof d === 'string') msg = d;
      else if (d && typeof d.code === 'string') {
        // Der Server liefert einen Code; den Text dazu gibt es in der gewählten Sprache.
        code = d.code;
        msg = tMaybe(`err.${d.code}`, d.message ?? msg, d.params);
      } else if (d) msg = t('err.invalid');
    } catch { /* keine JSON-Antwort */ }
    throw new ApiError(res.status, msg, code);
  }
  return res.json() as Promise<T>;
}

const q = (params: Record<string, string | number | undefined | null>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export interface EventQuery {
  camera?: string;
  label?: string;
  start?: number;
  end?: number;
  after?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}

export const api = {
  auth: {
    me: () => request<AuthState>('/api/auth/me'),
    login: (username: string, password: string) =>
      request<{ user: User; version: string }>('/api/auth/login', { method: 'POST', body: { username, password } }),
    setup: (username: string, password: string) =>
      request<{ ok: boolean }>('/api/auth/setup', { method: 'POST', body: { username, password } }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    changePassword: (current: string, next: string) =>
      request<{ ok: boolean }>('/api/auth/password', { method: 'POST', body: { current, new: next } }),
  },
  cameras: {
    list: (signal?: AbortSignal) => request<Camera[]>('/api/cameras', { signal }),
    liveUrl: (cam: string, fps?: number) => `/api/cameras/${encodeURIComponent(cam)}/live.mjpg${q({ fps })}`,
    latestUrl: (cam: string) => `/api/cameras/${encodeURIComponent(cam)}/latest.jpg`,
    frameUrl: (cam: string, ts: number, download = false) =>
      `/api/cameras/${encodeURIComponent(cam)}/frame/${Math.round(ts)}${download ? '?download=1' : ''}`,
    index: (cam: string, minute: number) =>
      request<MinuteIndex>(`/api/cameras/${encodeURIComponent(cam)}/index${q({ minute })}`),
    timeline: (cam: string, start: number, end: number) =>
      request<TimelineEntry[]>(`/api/cameras/${encodeURIComponent(cam)}/timeline${q({ start: Math.round(start), end: Math.round(end) })}`),
    detections: (cam: string, start: number, end: number) =>
      request<DetectionRow[]>(`/api/cameras/${encodeURIComponent(cam)}/detections${q({ start, end })}`),
    liveDetections: (cam: string) =>
      request<LiveDetections>(`/api/cameras/${encodeURIComponent(cam)}/detections/latest`),
    test: (c: CameraConfig) => request<ProbeResult>('/api/cameras/test', { method: 'POST', body: c }),
    save: (c: CameraConfig) => request<{ ok: boolean; name: string }>('/api/cameras', { method: 'POST', body: c }),
    remove: (cam: string) => request<{ ok: boolean }>(`/api/cameras/${encodeURIComponent(cam)}`, { method: 'DELETE' }),
  },
  events: {
    list: (p: EventQuery = {}) => request<EventItem[]>(`/api/events${q({ ...p })}`),
    labels: () => request<string[]>('/api/labels'),
    remove: (id: number) => request<{ ok: boolean }>(`/api/events/${id}`, { method: 'DELETE' }),
    thumbUrl: (e: Pick<EventItem, 'id' | 'score'>) => `/api/events/${e.id}/thumb.jpg?s=${Math.round(e.score * 1000)}`,
    preview: (id: number) => request<{ frames: number[] }>(`/api/events/${id}/preview`),
    snapshotUrl: (id: number) => `/api/events/${id}/snapshot.jpg`,
    previewUrl: (id: number, n: number) => `/api/events/${id}/preview/${n}.jpg`,
  },
  system: {
    stats: (signal?: AbortSignal) => request<Stats>('/api/stats', { signal }),
    config: () => request<Config>('/api/config'),
    changelog: (lang: string) => request<{ version: string; markdown: string }>(`/api/changelog?lang=${lang}`),
    saveSettings: (p: SettingsPatch) => request<{ ok: boolean }>('/api/settings', { method: 'PUT', body: p }),
  },
  models: {
    list: () => request<ModelList>('/api/models'),
    download: (id: string) => request<{ ok: boolean }>('/api/models/download', { method: 'POST', body: { file: id } }),
    select: (file: string) => request<{ ok: boolean }>('/api/models/active', { method: 'PUT', body: { file } }),
    remove: (file: string) => request<{ ok: boolean }>(`/api/models/${encodeURIComponent(file)}`, { method: 'DELETE' }),
    /** Eigenes ONNX-Modell hochladen (Rohdaten, wird auf dem Server geprüft). */
    upload: async (file: File): Promise<void> => {
      const res = await fetch(`/api/models/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'PUT', body: file, headers: { 'X-Kestrel': '1', 'Content-Type': 'application/octet-stream' }, credentials: 'same-origin',
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))).detail;
        throw new ApiError(res.status, d?.code ? tMaybe(`err.${d.code}`, d.message, d.params) : `${res.status}`, d?.code ?? '');
      }
    },
  },
  users: {
    list: () => request<User[]>('/api/users'),
    create: (username: string, password: string, role: Role) =>
      request<{ id: number }>('/api/users', { method: 'POST', body: { username, password, role } }),
    update: (id: number, patch: { role?: Role; password?: string }) =>
      request<{ ok: boolean }>(`/api/users/${id}`, { method: 'PUT', body: patch }),
    remove: (id: number) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
  },
  integrations: {
    list: () => request<Integrations>('/api/integrations'),
    decide: (id: string, allow: boolean) =>
      request<{ ok: boolean }>('/api/integrations/decide', { method: 'POST', body: { id, allow } }),
    revoke: (id: number) => request<{ ok: boolean }>(`/api/integrations/${id}`, { method: 'DELETE' }),
  },
};
