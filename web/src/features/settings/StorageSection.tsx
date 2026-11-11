import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Config, StorageStats } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Loader } from '../../components/ui/Loader';
import { Segmented } from '../../components/ui/Segmented';
import { Switch } from '../../components/ui/Switch';
import { useToast } from '../../context/ToastContext';
import { t } from '../../i18n';
import { fmtBytes, fmtCapacity } from '../../lib/format';

const QUALITY_CRF = ['22', '26', '30'] as const;

export function StorageSection() {
  const toast = useToast();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.system.config(), api.system.stats()])
      .then(([c, s]) => { setCfg(c); setStats(s.storage); })
      .catch(e => toast.error(e));
  }, [toast]);

  if (!cfg) return <Loader />;
  const s = cfg.storage;
  const tc = cfg.transcode;
  const setS = (patch: Partial<Config['storage']>) => setCfg({ ...cfg, storage: { ...s, ...patch } });
  const setT = (patch: Partial<Config['transcode']>) => setCfg({ ...cfg, transcode: { ...tc, ...patch } });
  const QUALITY = [
    { value: QUALITY_CRF[0], label: t('sto.q.high') },
    { value: QUALITY_CRF[1], label: t('sto.q.balanced') },
    { value: QUALITY_CRF[2], label: t('sto.q.economy') },
  ];
  const quality = QUALITY.reduce((best, q) => (Math.abs(Number(q.value) - tc.crf) < Math.abs(Number(best.value) - tc.crf) ? q : best)).value;
  const tr = stats?.transcode;

  const save = async () => {
    setBusy(true);
    try {
      await api.system.saveSettings({
        retention_days: s.retention_days, max_gb: s.max_gb, min_free_gb: s.min_free_gb,
        transcode_enabled: tc.enabled, transcode_crf: tc.crf, transcode_threads: tc.threads,
        cache_gb: tc.cache_gb, cache_minutes: tc.cache_minutes,
      });
      toast.success(t('common.saved'));
      setStats((await api.system.stats()).storage);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="cols">
        <Card title={t('sto.retention')}>
          <div className="form">
            <Field label={t('sto.days')} hint={t('sto.unlimited')}><input className="input" type="number" min={0} step={0.5} value={s.retention_days} onChange={e => setS({ retention_days: Number(e.target.value) })} /></Field>
            <Field label={t('sto.maxGb')} hint={t('sto.unlimited')}><input className="input" type="number" min={0} value={s.max_gb} onChange={e => setS({ max_gb: Number(e.target.value) })} /></Field>
            <Field label={t('sto.minFree')}><input className="input" type="number" min={0.5} step={0.5} value={s.min_free_gb} onChange={e => setS({ min_free_gb: Number(e.target.value) })} /></Field>
          </div>
          <p className="small muted">{t('sto.guard')}</p>
          {stats && <p className="small">{t('sto.current', { used: fmtBytes(stats.used), span: fmtCapacity(stats.capacity_days) })}</p>}
        </Card>

        <Card title={t('sto.h265')}>
          <Switch label={t('sto.h265Switch')} checked={tc.enabled} onChange={v => setT({ enabled: v })} />
          <div style={{ margin: '12px 0' }}>
            <Field label={t('sto.quality')}><Segmented label={t('sto.quality')} options={QUALITY} value={quality} onChange={v => setT({ crf: Number(v) })} size="md" /></Field>
          </div>
          <div className="form">
            <Field label={t('sto.cores')} hint={t('sto.coresOf', { n: cfg.cpu_count })}>
              <select className="input" value={tc.threads} onChange={e => setT({ threads: Number(e.target.value) })}>
                <option value={0}>{t('sto.coresAuto')}</option>
                {Array.from({ length: cfg.cpu_count }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </Field>
            <Field label={t('sto.cacheGb')}><input className="input" type="number" min={0.2} step={0.5} value={tc.cache_gb} onChange={e => setT({ cache_gb: Number(e.target.value) })} /></Field>
            <Field label={t('sto.cacheMin')}><input className="input" type="number" min={1} value={tc.cache_minutes} onChange={e => setT({ cache_minutes: Number(e.target.value) })} /></Field>
          </div>
          <p className="small muted">{t('sto.h265Text')} <b>{t('sto.h265Lossy')}</b> {t('sto.h265LossyText')}</p>
          {tr && (
            <p className="small">
              {tr.raw_bytes
                ? t('sto.soFar', { raw: fmtBytes(tr.raw_bytes), packed: fmtBytes(tr.packed_bytes), pct: ((1 - tr.packed_bytes / tr.raw_bytes) * 100).toFixed(1) })
                : t('sto.nothingYet')}
              {tr.backlog_bytes ? t('sto.backlog', { size: fmtBytes(tr.backlog_bytes) }) : ''}
              {!tr.available ? t('sto.noFfmpeg') : ''}
            </p>
          )}
        </Card>
      </div>
      <div className="row" style={{ marginTop: 16 }}><Button variant="primary" disabled={busy} onClick={save}>{t('common.saveSettings')}</Button></div>
    </>
  );
}
