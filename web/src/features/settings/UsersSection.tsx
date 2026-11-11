import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../api/client';
import type { Role, User } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { useToast } from '../../context/ToastContext';
import { t } from '../../i18n';
import { fmtDate } from '../../lib/format';

export function UsersSection() {
  const { user: me } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [users, setUsers] = useState<User[]>([]);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  const load = useCallback(async () => { try { setUsers(await api.users.list()); } catch (e) { toast.error(e); } }, [toast]);
  useEffect(() => { void load(); }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.users.create(name.trim(), password, role);
      toast.success(t('usr.added'));
      setName(''); setPassword(''); setRole('viewer');
      await load();
    } catch (err) { toast.error(err); }
  };
  const changeRole = async (u: User, r: Role) => {
    try { await api.users.update(u.id, { role: r }); toast.success(t('usr.roleChanged')); } catch (err) { toast.error(err); }
    await load();
  };
  const setPw = async (u: User) => {
    const pw = await dialog.prompt({ title: t('usr.newPasswordFor', { name: u.username }), label: t('login.passwordMin'), type: 'password', minLength: 8, confirmLabel: t('usr.set') });
    if (!pw) return;
    try { await api.users.update(u.id, { password: pw }); toast.success(t('usr.passwordSet')); } catch (err) { toast.error(err); }
  };
  const remove = async (u: User) => {
    if (!(await dialog.confirm({ title: t('usr.deleteTitle', { name: u.username }), confirmLabel: t('common.delete'), danger: true }))) return;
    try { await api.users.remove(u.id); await load(); } catch (err) { toast.error(err); }
  };

  return (
    <>
      <Card title={t('usr.title')} padded={false}>
        <div className="scroll">
          <table className="table">
            <thead><tr><th>{t('usr.col.user')}</th><th>{t('usr.col.role')}</th><th>{t('usr.col.created')}</th><th /></tr></thead>
            <tbody>
              {users.map(u => {
                const self = u.id === me?.id;
                return (
                  <tr key={u.id}>
                    <td><b>{u.username}</b> {self && <Badge tone="accent">{t('usr.me')}</Badge>}</td>
                    <td>
                      <select className="input input--compact" value={u.role} disabled={self} onChange={e => changeRole(u, e.target.value as Role)} aria-label={t('usr.roleOf', { name: u.username })}>
                        <option value="admin">{t('role.admin')}</option><option value="viewer">{t('role.viewer')}</option>
                      </select>
                    </td>
                    <td>{u.created ? fmtDate(u.created * 1000) : '–'}</td>
                    <td className="table__actions">
                      {!self && <Button size="sm" icon={<KeyRound size={14} />} onClick={() => setPw(u)}>{t('usr.setPassword')}</Button>}
                      {!self && <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => remove(u)} aria-label={t('common.delete')} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={t('usr.addTitle')} className="section">
        <form onSubmit={add}>
          <div className="form">
            <Field label={t('common.username')}><input className="input" value={name} autoComplete="off" autoCapitalize="none" onChange={e => setName(e.target.value)} required /></Field>
            <Field label={t('login.passwordMin')}><input className="input" type="password" value={password} autoComplete="new-password" onChange={e => setPassword(e.target.value)} required minLength={8} /></Field>
            <Field label={t('usr.col.role')}>
              <select className="input" value={role} onChange={e => setRole(e.target.value as Role)}>
                <option value="viewer">{t('usr.viewerOpt')}</option><option value="admin">{t('role.admin')}</option>
              </select>
            </Field>
          </div>
          <div className="row" style={{ marginTop: 14 }}><Button variant="primary" type="submit" icon={<UserPlus size={16} />}>{t('usr.add')}</Button></div>
        </form>
      </Card>
    </>
  );
}
