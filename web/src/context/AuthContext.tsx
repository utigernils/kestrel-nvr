import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';

type Status = 'loading' | 'setup' | 'anonymous' | 'authenticated' | 'offline';

interface AuthValue {
  status: Status;
  user: User | null;
  version: string;
  isAdmin: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [version, setVersion] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await api.auth.me();
      setUser(r.user);
      setVersion(r.version ?? '');
      setStatus(r.user ? 'authenticated' : r.setup_required ? 'setup' : 'anonymous');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setStatus('anonymous'); });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    await api.auth.login(username, password);
    await refresh();
  }, [refresh]);

  const setup = useCallback(async (username: string, password: string) => {
    await api.auth.setup(username, password);
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try { await api.auth.logout(); } catch { /* Sitzung war schon weg */ }
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthValue>(() => ({
    status, user, version, isAdmin: user?.role === 'admin', login, setup, logout, refresh,
  }), [status, user, version, login, setup, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth ausserhalb von AuthProvider');
  return ctx;
}
