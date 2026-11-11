import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { CameraConfig } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { t } from '../../i18n';

const EMPTY: CameraConfig = {
  name: '', host: '', type: 'mobotix', url: '', sub_url: '', live_fps: 5, port: 80, scheme: 'http', username: 'admin', password: '', sensor: 'auto', fps: 0, extra_params: '', detect: true,
};

export function CamerasSection() {
  const toast = useToast();
  const dialog = useDialog();
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  const [form, setForm] = useState<CameraConfig | null>(null);
  const [editing, setEditing] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setCameras((await api.system.config()).cameras); } catch (e) { toast.error(e); }
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof CameraConfig>(key: K, value: CameraConfig[K]) => setForm(f => (f ? { ...f, [key]: value } : f));
  const openNew = () => { setForm({ ...EMPTY }); setEditing(false); setTestResult(null); };
  const openEdit = (c: CameraConfig) => { setForm({ ...c, password: '' }); setEditing(true); setTestResult(null); };

  const test = async () => {
    if (!form || !(form.type === 'mobotix' ? form.host : form.url)) { toast.info(t('cam.needAddress')); return; }
    setBusy(true);
    setTestResult({ ok: true, text: t('cam.testing') });
    try {
      const r = await api.cameras.test({ ...form, name: form.name || 'test' });
      const info = `${r.codec ? `${r.codec.toUpperCase()}, ` : ''}${r.width ?? '?'}×${r.height ?? '?'}${r.fps ? `, ~${r.fps} ${t('unit.fps')}` : ''}`;
      setTestResult(r.ok ? { ok: true, text: t('cam.testOk', { info }) } : { ok: false, text: t('cam.testFail', { error: r.error ?? '' }) });
    } catch (e) {
      setTestResult({ ok: false, text: t('cam.testFail', { error: (e as Error).message }) });
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!form?.name || !(form.type === 'mobotix' ? form.host : form.url)) { toast.info(t('cam.needNameAddress')); return; }
    setBusy(true);
    try {
      await api.cameras.save(form);
      toast.success(t('cam.saved'));
      setForm(null);
      await load();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  const remove = async (c: CameraConfig) => {
    const ok = await dialog.confirm({
      title: t('cam.removeTitle', { name: c.name }), text: t('cam.removeText'), confirmLabel: t('common.remove'), danger: true,
    });
    if (!ok) return;
    try { await api.cameras.remove(c.name); await load(); } catch (e) { toast.error(e); }
  };

  return (
    <>
      <Card title={t('cam.title')} padded={false} actions={<Button variant="primary" icon={<Plus size={16} />} onClick={openNew}>{t('cam.add')}</Button>}>
        <div className="scroll">
          <table className="table">
            <thead><tr>{(['name', 'type', 'address', 'user', 'detection'] as const).map(c => <th key={c}>{t(`cam.col.${c}`)}</th>)}<th /></tr></thead>
            <tbody>
              {cameras.map(c => (
                <tr key={c.name}>
                  <td><b>{c.name}</b></td>
                  <td>{t(`cam.typeShort.${c.type}`)}</td>
                  <td className="cell-url">{c.type === 'mobotix' ? `${c.scheme}://${c.host}:${c.port}` : c.url}</td>
                  <td>{c.username || '–'}</td>
                  <td>{t(c.detect ? 'common.on' : 'common.off')}</td>
                  <td className="table__actions">
                    <Button size="sm" icon={<Pencil size={14} />} onClick={() => openEdit(c)}>{t('common.edit')}</Button>
                    <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => remove(c)} aria-label={t('common.remove')} />
                  </td>
                </tr>
              ))}
              {cameras.length === 0 && <tr><td colSpan={6} className="muted">{t('cam.empty')}</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="hint">
        <b>{t('cam.tip')}</b> {t('cam.tipText')}
      </p>

      <Modal open={!!form} title={editing ? t('cam.editTitle', { name: form?.name ?? '' }) : t('cam.add')} onClose={() => setForm(null)} wide>
        {form && (
          <form onSubmit={e => { e.preventDefault(); void save(); }}>
            <div className="form">
              <Field label={t('cam.col.name')}><input className="input" value={form.name} disabled={editing} placeholder="eingang" onChange={e => set('name', e.target.value)} /></Field>
              <Field label={t('cam.type')}>
                <select className="input" value={form.type} onChange={e => set('type', e.target.value as CameraConfig['type'])}>
                  <option value="mobotix">{t('cam.type.mobotix')}</option>
                  <option value="rtsp">{t('cam.type.rtsp')}</option>
                  <option value="mjpeg">{t('cam.type.mjpeg')}</option>
                </select>
              </Field>
            </div>
            <p className="small muted form-note">
              {t(`cam.note.${form.type}`)}
            </p>
            <div className="form">
              {form.type === 'mobotix' ? (
                <>
                  <Field label={t('cam.host')}><input className="input" value={form.host} placeholder="192.168.1.50" onChange={e => set('host', e.target.value)} /></Field>
                  <Field label={t('cam.port')}><input className="input" type="number" value={form.port} onChange={e => set('port', Number(e.target.value) || 80)} /></Field>
                  <Field label={t('cam.scheme')}>
                    <select className="input" value={form.scheme} onChange={e => set('scheme', e.target.value as CameraConfig['scheme'])}><option>http</option><option>https</option></select>
                  </Field>
                </>
              ) : (
                <div className="form__wide">
                  <Field label={t(form.type === 'rtsp' ? 'cam.mainUrl' : 'cam.mjpegUrl')}>
                    <input className="input" value={form.url} placeholder={form.type === 'rtsp' ? 'rtsp://192.168.1.60:554/stream1' : 'http://192.168.1.70/video.mjpg'} onChange={e => set('url', e.target.value)} />
                  </Field>
                </div>
              )}
              {form.type === 'rtsp' && (
                <div className="form__wide">
                  <Field label={t('cam.subUrl')} hint={t('cam.subHint')}>
                    <input className="input" value={form.sub_url} placeholder="rtsp://192.168.1.60:554/stream2" onChange={e => set('sub_url', e.target.value)} />
                  </Field>
                </div>
              )}
              <Field label={t('cam.col.user')}><input className="input" value={form.username} autoComplete="off" onChange={e => set('username', e.target.value)} /></Field>
              <Field label={t('common.password')}><input className="input" type="password" value={form.password} autoComplete="new-password" placeholder={editing ? t('cam.unchanged') : ''} onChange={e => set('password', e.target.value)} /></Field>
              {form.type === 'mobotix' && (
                <>
                  <Field label={t('cam.sensor')}>
                    <select className="input" value={form.sensor} onChange={e => set('sensor', e.target.value as CameraConfig['sensor'])}>
                      {(['auto', 'right', 'left', 'both'] as const).map(v => <option key={v} value={v}>{t(`cam.sensor.${v}`)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('cam.maxFps')}><input className="input" type="number" min={0} step={0.5} value={form.fps} onChange={e => set('fps', Number(e.target.value) || 0)} /></Field>
                  <Field label={t('cam.extra')}><input className="input" value={form.extra_params} placeholder={t('common.optional')} onChange={e => set('extra_params', e.target.value)} /></Field>
                </>
              )}
              {form.type === 'rtsp' && (
                <Field label={t('cam.liveFps')}><input className="input" type="number" min={0.5} max={30} step={0.5} value={form.live_fps} onChange={e => set('live_fps', Number(e.target.value) || 5)} /></Field>
              )}
              <Field label={t('cam.detection')}>
                <select className="input" value={form.detect ? '1' : '0'} onChange={e => set('detect', e.target.value === '1')}><option value="1">{t('common.on')}</option><option value="0">{t('common.off')}</option></select>
              </Field>
            </div>
            {testResult && <p className={`small ${testResult.ok ? 'text-ok' : 'text-bad'}`}>{testResult.text}</p>}
            <div className="row row--end" style={{ marginTop: 16 }}>
              <Button onClick={test} disabled={busy}>{t('cam.test')}</Button>
              <Button variant="primary" type="submit" disabled={busy}>{t('common.save')}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
