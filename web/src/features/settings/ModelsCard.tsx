import { useCallback, useRef, useState } from 'react';
import { Check, Download, Trash2, Upload } from 'lucide-react';
import { api } from '../../api/client';
import type { ModelInfo } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { usePolling } from '../../hooks/usePolling';
import { t, tMaybe } from '../../i18n';
import { fmtBytes } from '../../lib/format';

/** Erkennungsmodell wählen: Katalog (Download auf Klick), eigene ONNX-Dateien, Wechsel ohne Neustart. */
export function ModelsCard() {
  const toast = useToast();
  const dialog = useDialog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const wasLoading = useRef<string | null>(null);
  const { data, reload } = usePolling(useCallback(() => api.models.list(), []), 1500);

  // Ende eines Downloads melden (der Server lädt im Hintergrund).
  const dl = data?.download;
  if (dl) {
    if (dl.id && !dl.done) wasLoading.current = dl.id;
    else if (wasLoading.current && dl.done) {
      wasLoading.current = null;
      queueMicrotask(() => (dl.error
        ? toast.error(t('det.model.downloadFailed', { error: tMaybe(`err.${dl.error}`, dl.error) }))
        : toast.success(t('det.model.downloaded'))));
    }
  }

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await fn(); if (done) toast.success(done); } catch (e) { toast.error(e); } finally { setBusy(''); reload(); }
  };
  const remove = async (m: ModelInfo) => {
    if (!(await dialog.confirm({ title: t('det.model.deleteTitle', { name: m.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    await run(m.file, () => api.models.remove(m.file));
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    await run('upload', () => api.models.upload(file), t('det.model.uploaded'));
    if (fileRef.current) fileRef.current.value = '';
  };

  const models = data?.models ?? [];
  const active = models.find(m => m.active);
  return (
    <Card title={t('det.models')} className="section">
      <p className="muted" style={{ marginBottom: 12 }}>{t('det.modelsText')}</p>
      {data?.error && <p className="hint" style={{ margin: '0 0 12px' }}>{tMaybe(`err.${data.error_code}`, data.error, { reason: data.error })}</p>}
      <ul className="models">
        {models.map(m => {
          const loading = dl?.id === m.id && !dl.done;
          const pct = loading && dl.total ? Math.round((dl.received / dl.total) * 100) : 0;
          return (
            <li key={m.file} className={`model ${m.active ? 'is-active' : ''}`}>
              <div className="model__text">
                <b>{m.name} {m.active && <Badge tone="ok">{t('det.model.active')}</Badge>}</b>
                <span className="small muted">
                  {m.custom ? t('det.model.custom') : t(`det.model.${m.speed ?? 'fast'}`)}
                  {' · '}
                  {m.custom ? fmtBytes(m.bytes) : t('det.model.info', { size: fmtBytes(m.bytes), input: m.input ?? '?', map: m.map ?? '?', license: m.license ?? '' })}
                </span>
                {loading && <span className="meter" style={{ marginTop: 6 }}><i className="meter__fill meter__fill--accent" style={{ width: `${pct}%` }} /></span>}
              </div>
              <div className="row model__actions">
                {loading ? <span className="small muted">{t('det.model.downloading', { pct })}</span>
                  : !m.installed ? <Button icon={<Download size={15} />} disabled={!!busy || (!!dl?.id && !dl.done)} onClick={() => run(m.id, () => api.models.download(m.id))}>{t('det.model.download')}</Button>
                  : !m.active ? <Button icon={<Check size={15} />} disabled={!!busy} onClick={() => run(m.file, () => api.models.select(m.file), t('det.model.switched'))}>{t('det.model.use')}</Button>
                  : null}
                {m.deletable && m.installed && !m.active && (
                  <Button variant="danger" icon={<Trash2 size={15} />} disabled={!!busy} onClick={() => remove(m)} aria-label={t('common.delete')} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {active && data?.input && (
        <p className="small" style={{ marginTop: 12 }}>
          {t('det.model.current', { name: active.name, kind: data.kind ?? '?', input: data.input.join('×'), ms: data.inference_ms ?? '–' })}
        </p>
      )}
      <div className="row" style={{ marginTop: 14 }}>
        <input ref={fileRef} type="file" accept=".onnx" hidden onChange={e => { void upload(e.target.files?.[0]); }} />
        <Button icon={<Upload size={15} />} disabled={!!busy} onClick={() => fileRef.current?.click()}>
          {busy === 'upload' ? t('det.model.uploading') : t('det.model.upload')}
        </Button>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>{t('det.model.uploadHint')} {t('det.model.source')}</p>
    </Card>
  );
}
