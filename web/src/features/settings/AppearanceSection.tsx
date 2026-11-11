import { Check, Download } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Segmented';
import { usePrefs } from '../../context/PrefsContext';
import { useToast } from '../../context/ToastContext';
import { LANGUAGES, t, type LangSetting } from '../../i18n';
import { promptInstall, useInstallState } from '../../lib/install';
import { getPalette, THEMES, type ModeSetting } from '../../lib/theme';

/** Theme, Hell/Dunkel, Sprache, Tempo des Farbverlaufs und Installation als App. Gilt für diesen Browser. */
export function AppearanceSection() {
  const { theme, setTheme, mode, modeSetting, setModeSetting, langSetting, setLangSetting, auroraSpeed, setAuroraSpeed } = usePrefs();
  const toast = useToast();
  const install = useInstallState();
  const modes: { value: ModeSetting; label: string }[] = [
    { value: 'dark', label: t('app2.mode.dark') },
    { value: 'light', label: t('app2.mode.light') },
    { value: 'auto', label: t('app2.mode.auto') },
  ];
  const doInstall = async () => { if (await promptInstall()) toast.success(t('app2.installDone')); };

  return (
    <div className="narrow">
      <Card title={t('app2.theme')}>
        <div className="themes">
          {THEMES.map(th => {
            const p = getPalette(th.name, mode);
            const on = th.name === theme;
            return (
              <button key={th.name} type="button" className={`theme ${on ? 'is-on' : ''}`} onClick={() => setTheme(th.name)} aria-pressed={on}>
                <span className="theme__preview" style={{ background: p.bg, borderColor: p.line }} aria-hidden="true">
                  {th.name === 'kestrel' && <i className="theme__glow" />}
                  {th.name === 'levin' && <i className="theme__side" style={{ background: p.navBg }} />}
                  <i className="theme__card" style={{ background: p.surface, borderColor: p.line, borderRadius: p.radiusSm }}>
                    <b style={{ background: p.text }} /><b style={{ background: p.mute }} /><b style={{ background: p.primaryBg }} />
                  </i>
                </span>
                <span className="theme__text">
                  <b>{th.label} {on && <Check size={15} />}</b>
                  <small className="muted">{t(`app2.theme.${th.name}`)}</small>
                </span>
              </button>
            );
          })}
        </div>
        <div className="form" style={{ marginTop: 16 }}>
          <Field label={t('app2.mode')} hint={t('app2.modeHint')}>
            <Segmented label={t('app2.mode')} options={modes} value={modeSetting} onChange={setModeSetting} size="md" />
          </Field>
          <Field label={t('app2.language')}>
            <select className="input" value={langSetting} onChange={e => setLangSetting(e.target.value as LangSetting)} aria-label={t('app2.language')}>
              <option value="auto">{t('app2.langAuto')}</option>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      {theme === 'kestrel' && (
        <Card title={t('app2.kestrel')} className="section">
          <div className="range-row">
            <label htmlFor="aurora-speed">{t('app2.speed')}</label>
            <output htmlFor="aurora-speed">{auroraSpeed === 0 ? t('app2.speedStill') : `${auroraSpeed} %`}</output>
          </div>
          <input id="aurora-speed" className="range" type="range" min={0} max={200} step={10} value={auroraSpeed}
                 onChange={e => setAuroraSpeed(Number(e.target.value))} />
          <p className="small muted" style={{ marginTop: 8 }}>{t('app2.speedHint')}</p>
        </Card>
      )}

      <Card title={t('app2.install')} className="section">
        <p className="muted" style={{ marginBottom: 12 }}>{t('app2.installText')}</p>
        {install === 'available' && <Button variant="primary" icon={<Download size={16} />} onClick={doInstall}>{t('app2.installBtn')}</Button>}
        {install === 'installed' && <p><Check size={15} style={{ verticalAlign: '-2px' }} /> {t('app2.installed')}</p>}
        {install === 'ios' && <p className="hint" style={{ marginTop: 0 }}>{t('app2.installIos')}</p>}
        {install === 'insecure' && <p className="hint" style={{ marginTop: 0 }}>{t('app2.installInsecure')}</p>}
        {install === 'manual' && <p className="hint" style={{ marginTop: 0 }}>{t('app2.installManual')}</p>}
      </Card>
      <p className="small muted" style={{ marginTop: 12 }}>{t('app2.stored')}</p>
    </div>
  );
}
