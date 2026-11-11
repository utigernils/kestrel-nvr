export type Role = 'admin' | 'viewer';

export interface User {
  id: number;
  username: string;
  role: Role;
  created?: number;
}

export interface AuthState {
  user: User | null;
  setup_required: boolean;
  version?: string;
}

export type CameraType = 'mobotix' | 'mjpeg' | 'rtsp';

export interface Camera {
  name: string;
  host: string;
  type: CameraType;
  codec: string;
  state: string;
  error: string;
  fps: number;
  kbps: number;
  frames: number;
  width: number | null;
  height: number | null;
  last_ts: number | null;
  uptime: number;
  detect: boolean;
  sensor?: string;
}

/** [label, score, x1, y1, x2, y2, trackId?] – Koordinaten normiert auf 0..1 */
export type Box = [string, number, number, number, number, number, number?];

export interface LiveDetections {
  ts: number;
  now: number;
  dets: Box[];
}

export interface EventItem {
  id: number;
  camera: string;
  label: string;
  start_ts: number;
  end_ts: number;
  score: number;
  best_ts: number | null;
  active: number;
  previews: number;
}

export interface TranscodeStats {
  enabled: boolean;
  available: boolean;
  current: string;
  minutes: number;
  skipped: number;
  raw_bytes: number;
  packed_bytes: number;
  ratio: number;
  ratio_measured: boolean;
  backlog_bytes: number;
  backlog_hours: number;
  cpu_seconds: number;
}

export interface StorageStats {
  used: number;
  disk_total: number;
  disk_free: number;
  oldest: number | null;
  rate_bps: number;
  raw_bps: number;
  effective_bps: number;
  capacity_days: number | null;
  paused: boolean;
  warning: string;
  warning_code: string;
  warning_params: Record<string, string | number>;
  cache_bytes: number;
  transcode: TranscodeStats;
}

export interface DetectorStats {
  enabled: boolean;
  loaded: boolean;
  error: string;
  error_code: string;
  inference_ms: number | null;
  runs: number;
  skipped_no_motion: number;
  model: string;
  kind: string | null;
}

export interface Stats {
  version: string;
  uptime: number;
  cpu_percent: number;
  cpu_count: number;
  load: number[];
  cameras: Camera[];
  detector: DetectorStats | null;
  storage: StorageStats;
}

export interface CameraConfig {
  name: string;
  host: string;
  type: CameraType;
  url: string;
  sub_url: string;
  live_fps: number;
  port: number;
  scheme: 'http' | 'https';
  username: string;
  password: string;
  sensor: 'auto' | 'right' | 'left' | 'both';
  fps: number;
  extra_params: string;
  detect: boolean;
  enabled?: boolean;
}

export interface Config {
  cameras: CameraConfig[];
  storage: { path: string; retention_days: number; max_gb: number; min_free_gb: number };
  detect: { enabled: boolean; fps: number; score: number; labels: string[]; motion_gate: boolean; threads: number; model: string };
  transcode: { enabled: boolean; crf: number; preset: string; threads: number; cache_gb: number; cache_minutes: number };
  all_labels: string[];
  cpu_count: number;
}

export interface SettingsPatch {
  retention_days?: number;
  max_gb?: number;
  min_free_gb?: number;
  detect_enabled?: boolean;
  detect_fps?: number;
  detect_score?: number;
  detect_labels?: string[];
  motion_gate?: boolean;
  transcode_enabled?: boolean;
  transcode_crf?: number;
  transcode_threads?: number;
  cache_gb?: number;
  cache_minutes?: number;
}

export interface ProbeResult {
  ok: boolean;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
  error?: string;
}

export interface HaClient {
  id: number;
  name: string;
  created: number;
  last_seen: number | null;
  ip: string | null;
  approved_by: string | null;
}

export interface PairRequest {
  id: string;
  name: string;
  ip: string;
  code: string;
  created: number;
  expires_in: number;
}

export interface Integrations {
  clients: HaClient[];
  pending: PairRequest[];
}

export interface MinuteIndex {
  minute: number;
  ts: number[];
  len: number[];
  codec: 'jpeg' | 'video' | 'zip' | 'none';
}

/** [ts, label, score, x1, y1, x2, y2, trackId] */
export type DetectionRow = [number, string, number, number, number, number, number, number];

/** [minuteStartMs, frameCount] */
export type TimelineEntry = [number, number];

export interface ModelInfo {
  id: string;
  name: string;
  file: string;
  bytes: number;
  custom: boolean;
  installed: boolean;
  active: boolean;
  deletable: boolean;
  path: string | null;
  input?: number;
  map?: number;
  speed?: 'fastest' | 'fast' | 'slow';
  license?: string;
}

export interface ModelList {
  models: ModelInfo[];
  download: { id: string | null; received: number; total: number; error: string; done: boolean };
  active_path: string;
  inference_ms: number | null;
  kind: string | null;
  input: [number, number] | null;
  error: string;
  error_code: string;
}
