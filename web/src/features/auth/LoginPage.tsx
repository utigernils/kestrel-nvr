import { useState, type FormEvent } from 'react';
import { Background } from '../../components/layout/Background';
import { BrandMark } from '../../components/layout/Brand';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { useAuth } from '../../context/AuthContext';
import { t } from '../../i18n';

interface LoginPageProps { setup: boolean }

/** Anmeldung bzw. Ersteinrichtung (Admin-Konto anlegen). */
export function LoginPage({ setup }: LoginPageProps) {
  const { login, setup: createAdmin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (setup && password !== repeat) { setError(t('login.mismatch')); return; }
    setBusy(true);
    setError('');
    try {
      if (setup) await createAdmin(username.trim(), password);
      else await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Background full />
      <form className="login__card" onSubmit={submit} autoComplete="on">
        <div className="login__logo"><BrandMark size={44} /></div>
        <h1 className="login__title">{t('login.title')}</h1>
        <p className="muted login__sub">{t(setup ? 'login.setupPrompt' : 'login.prompt')}</p>
        <Field label={t('common.username')}>
          <input className="input" id="login-user" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username"
                 autoCapitalize="none" spellCheck={false} autoFocus required />
        </Field>
        <Field label={t(setup ? 'login.passwordMin' : 'common.password')}>
          <input className="input" id="login-pass" type="password" value={password} onChange={e => setPassword(e.target.value)}
                 autoComplete={setup ? 'new-password' : 'current-password'} required />
        </Field>
        {setup && (
          <Field label={t('login.passwordRepeat')}>
            <input className="input" type="password" value={repeat} onChange={e => setRepeat(e.target.value)} autoComplete="new-password" required />
          </Field>
        )}
        <div className="login__error" role="alert">{error}</div>
        <Button variant="primary" type="submit" className="btn--wide" disabled={busy}>{t(busy ? 'login.busy' : setup ? 'login.create' : 'login.submit')}</Button>
      </form>
    </div>
  );
}
