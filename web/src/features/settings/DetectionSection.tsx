import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Config } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Loader } from '../../components/ui/Loader';
import { Switch } from '../../components/ui/Switch';
import { useToast } from '../../context/ToastContext';
import { t } from '../../i18n';
import { COMMON_LABELS, labelColor, labelName } from '../../lib/labels';
import { ModelsCard } from './ModelsCard';

export function DetectionSection() {
  const toast = useToast();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.system.config().then(setCfg).catch(e => toast.error(e)); }, [toast]);
  if (!cfg) return <Loader />;

  const d = cfg.detect;
  const set = (patch: Partial<Config['detect']>) => setCfg({ ...cfg, detect: { ...d, ...patch } });
  const toggle = (l: string) => set({ labels: d.labels.includes(l) ? d.labels.filter(x => x !== l) : [...d.labels, l] });

  const save = async () => {
    setBusy(true);
    try {
      await api.system.saveSettings({
        detect_enabled: d.enabled, detect_fps: d.fps, detect_score: d.score, motion_gate: d.motion_gate, detect_labels: d.labels,
      });
      toast.success(t('common.saved'));
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <>
    <Card title={t('det.title')}>
      <Switch label={t('det.enabled')} checked={d.enabled} onChange={v => set({ enabled: v })} />
      <Switch label={t('det.motionGate')} checked={d.motion_gate} onChange={v => set({ motion_gate: v })} />
      <div className="form" style={{ marginTop: 14 }}>
        <Field label={t('det.fps')}><input className="input" type="number" min={0.2} max={30} step={0.5} value={d.fps} onChange={e => set({ fps: Number(e.target.value) })} /></Field>
        <Field label={t('det.score')}><input className="input" type="number" min={5} max={95} value={Math.round(d.score * 100)} onChange={e => set({ score: Number(e.target.value) / 100 })} /></Field>
      </div>
      <p className="field__label" style={{ marginTop: 16 }}>{t('det.labels')}</p>
      <div className="chips">
        {COMMON_LABELS.map(l => {
          const on = d.labels.includes(l);
          return (
            <button key={l} type="button" className={`chip ${on ? 'is-on' : ''}`} onClick={() => toggle(l)} aria-pressed={on}>
              <i className="chip__dot" style={{ background: labelColor(l) }} />{labelName(l)}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 18 }}><Button variant="primary" disabled={busy} onClick={save}>{t('common.saveSettings')}</Button></div>
    </Card>
    <ModelsCard />
    </>
  );
}
