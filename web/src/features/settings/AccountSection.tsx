import { useState, type FormEvent } from 'react';
import { LogOut } from 'lucide-react';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { t } from '../../i18n';

export function AccountSection() {
  const { user, isAdmin, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) { toast.error(t('acc.mismatch')); return; }
    try {
      await api.auth.changePassword(current, next);
      setCurrent(''); setNext(''); setRepeat('');
      toast.success(t('acc.changed'));
    } catch (err) { toast.error(err); }
  };

  return (
    <div className="narrow">
      <Card title={t('acc.title')}>
        <p className="muted" style={{ marginTop: 0 }}>{t('acc.signedInAs', { name: user?.username ?? '', role: t(isAdmin ? 'role.admin' : 'role.viewer') })}</p>
        <form onSubmit={submit}>
          <div className="form">
            <Field label={t('acc.current')}><input className="input" type="password" value={current} autoComplete="current-password" onChange={e => setCurrent(e.target.value)} required /></Field>
            <Field label={t('acc.new')}><input className="input" type="password" value={next} autoComplete="new-password" minLength={8} onChange={e => setNext(e.target.value)} required /></Field>
            <Field label={t('acc.repeat')}><input className="input" type="password" value={repeat} autoComplete="new-password" onChange={e => setRepeat(e.target.value)} required /></Field>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="primary" type="submit">{t('acc.change')}</Button>
            <Button variant="ghost" icon={<LogOut size={16} />} onClick={() => { void logout(); }}>{t('nav.logout')}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
