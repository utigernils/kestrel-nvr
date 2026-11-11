import { useCallback } from 'react';
import { api } from '../../api/client';
import { Badge, StatusDot } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Loader } from '../../components/ui/Loader';
import { PageHeader } from '../../components/ui/PageHeader';
import { Meter, Stat } from '../../components/ui/Stat';
import { usePolling } from '../../hooks/usePolling';
import { t, tMaybe } from '../../i18n';
import { fmtBytes, fmtCapacity, fmtDate, fmtDuration, fmtNumber, fmtTime } from '../../lib/format';

const SOURCE: Record<string, string> = { mobotix: 'MOBOTIX', mjpeg: 'M-JPEG', rtsp: 'RTSP' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (<><dt>{label}</dt><dd>{children}</dd></>);
}

export default function SystemPage() {
  const { data: s, loading } = usePolling(useCallback(signal => api.system.stats(signal), []), 2000);
  if (loading && !s) return <Loader />;
  if (!s) return null;

  const st = s.storage;
  const tr = st.transcode;
  const det = s.detector;
  const online = s.cameras.filter(c => c.state === 'online').length;
  const diskPct = st.disk_total ? (1 - st.disk_free / st.disk_total) * 100 : 0;
  const cpuPct = s.cpu_percent / s.cpu_count;
  const saved = (1 - tr.ratio) * 100;

  return (
    <>
      <PageHeader title={t('nav.system')} subtitle={t('sys.subtitle', { version: s.version, uptime: fmtDuration(s.uptime) })} />
      <div className="stats">
        <Card><Stat label={t('sys.camerasOnline')} value={online} suffix={` / ${s.cameras.length}`} /></Card>
        <Card><Stat label={t('sys.cpu')} value={cpuPct} decimals={0} suffix=" %" hint={<Meter value={cpuPct} tone={cpuPct > 85 ? 'bad' : cpuPct > 60 ? 'warn' : 'accent'} />} /></Card>
        <Card><Stat label={t('sys.recordings')} value={st.used / 1e9} decimals={1} suffix=" GB" hint={<Meter value={diskPct} tone={diskPct > 92 ? 'bad' : 'accent'} />} /></Card>
        <Card>
          <Stat label={t('sys.lastsFor')} value={st.capacity_days ?? 0} decimals={1} suffix={` ${t('sys.days')}`}
                hint={st.capacity_days == null ? t('common.measuring') : tr.enabled && tr.available ? t('sys.withH265', { kind: t(tr.ratio_measured ? 'sys.measured' : 'sys.estimated'), pct: saved.toFixed(0) }) : t('sys.noTranscode')} />
        </Card>
      </div>

      <Card padded={false} className="section">
        <div className="scroll">
          <table className="table">
            <thead><tr>{(['camera', 'status', 'source', 'resolution', 'fps', 'bitrate', 'frames', 'connected'] as const).map(c => <th key={c}>{t(`sys.col.${c}`)}</th>)}</tr></thead>
            <tbody>
              {s.cameras.map(c => (
                <tr key={c.name}>
                  <td><b>{c.name}</b><div className="small muted">{c.host}</div></td>
                  <td><Badge><StatusDot state={c.state} />{tMaybe(`state.${c.state}`, c.state)}</Badge>{c.error && <div className="small muted">{c.error}</div>}</td>
                  <td>{SOURCE[c.type] ?? c.type}{c.codec && c.codec !== 'mjpeg' ? ` · ${c.codec.toUpperCase()}` : ''}</td>
                  <td>{c.width ? `${c.width}×${c.height}` : '–'}</td>
                  <td>{c.fps.toFixed(1)} {t('unit.fps')}</td>
                  <td>{(c.kbps / 1000).toFixed(2)} Mbit/s</td>
                  <td>{fmtNumber(c.frames)}</td>
                  <td>{fmtDuration(c.uptime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="cols">
        <Card title={t('sys.storage')}>
          <dl className="kv">
            <Row label={t('sys.recordings')}>{fmtBytes(st.used)} {st.paused && <Badge tone="bad">{t('sys.paused')}</Badge>}</Row>
            <Row label={t('sys.free')}>{t('sys.freeOf', { free: fmtBytes(st.disk_free), total: fmtBytes(st.disk_total) })}</Row>
            <Row label={t('sys.camerasDeliver')}>{st.rate_bps ? t('unit.perDay', { size: fmtBytes(st.rate_bps * 86400) }) : t('common.measuring')}</Row>
            <Row label={t('sys.permanent')}>{st.rate_bps ? t('unit.perDay', { size: fmtBytes(st.effective_bps * 86400) }) : '–'}</Row>
            <Row label={t('sys.lastsFor')}>{st.capacity_days == null ? t('common.measuring') : t('sys.history', { span: fmtCapacity(st.capacity_days) })}</Row>
            <Row label={t('sys.oldest')}>{st.oldest ? `${fmtDate(st.oldest)} ${fmtTime(st.oldest)}` : '–'}</Row>
          </dl>
        </Card>

        <Card title={t('sys.transcode')}>
          <dl className="kv">
            <Row label={t('sys.status')}>
              {!tr.available ? <Badge tone="bad">{t('sys.ffmpegMissing')}</Badge> : !tr.enabled ? <Badge>{t('common.off')}</Badge>
                : tr.current ? <Badge>{t('sys.working', { what: tr.current })}</Badge> : <Badge tone="ok">{t('sys.waitingHour')}</Badge>}
            </Row>
            <Row label={t('sys.transcoded')}>{t('sys.minutes', { n: fmtNumber(tr.minutes) })}{tr.skipped ? t('sys.stayedJpeg', { n: tr.skipped }) : ''}</Row>
            <Row label={t('sys.saving')}>{tr.raw_bytes ? `${fmtBytes(tr.raw_bytes)} → ${fmtBytes(tr.packed_bytes)} (${((1 - tr.packed_bytes / tr.raw_bytes) * 100).toFixed(1)} %)` : t('sys.nothingMeasured')}</Row>
            <Row label={t('sys.backlog')}>{tr.backlog_bytes ? `${fmtBytes(tr.backlog_bytes)} (${tr.backlog_hours.toFixed(1)} h)` : t('common.none')}</Row>
            <Row label={t('sys.cpuTime')}>{fmtDuration(tr.cpu_seconds)}</Row>
            <Row label={t('sys.decoded')}>{fmtBytes(st.cache_bytes)}</Row>
          </dl>
        </Card>

        <Card title={t('sys.detection')}>
          <dl className="kv">
            <Row label={t('sys.status')}>{det?.error ? <Badge tone="bad">{det.error_code ? tMaybe(`err.${det.error_code}`, det.error, { reason: det.error }) : det.error}</Badge> : !det?.enabled ? <Badge>{t('common.off')}</Badge> : det.loaded ? <Badge tone="ok">{t('sys.active')}</Badge> : <Badge tone="warn">{t('sys.loadingModel')}</Badge>}</Row>
            <Row label={t('sys.model')}>{(det?.model ?? '').split('/').pop()}{det?.kind ? ` (${det.kind})` : ''}</Row>
            <Row label={t('sys.inference')}>{det?.inference_ms != null ? `${det.inference_ms} ms` : '–'}</Row>
            <Row label={t('sys.runs')}>{fmtNumber(det?.runs ?? 0)}</Row>
            <Row label={t('sys.skipped')}>{fmtNumber(det?.skipped_no_motion ?? 0)}</Row>
            <Row label={t('sys.load')}>{s.load.join(' · ')}</Row>
          </dl>
        </Card>
      </div>
    </>
  );
}
