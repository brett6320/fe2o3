import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useNavigate } from '@tanstack/react-router';
import {
  Activity,
  Braces,
  Building2,
  Cpu,
  FolderTree,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Moon,
  Router,
  ScrollText,
  Settings,
  Sun,
  User,
  Users,
  Webhook,
} from 'lucide-react';
import { api, post } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
import { useInvalidateSession, useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/devices', label: 'Devices', icon: Router },
  { to: '/groups', label: 'Groups', icon: FolderTree },
  { to: '/jobs', label: 'Jobs', icon: Activity },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
  { to: '/models', label: 'Models', icon: Cpu },
  { to: '/hooks', label: 'Hooks', icon: Webhook },
  { to: '/orgs', label: 'Organizations', icon: Building2 },
  { to: '/users', label: 'Users', icon: Users },
  { to: '/api-keys', label: 'API keys', icon: Braces },
  { to: '/audit', label: 'Audit', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      aria-label="Toggle theme"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

function OrgSwitcher() {
  const { orgId, orgs, setOrgId } = useOrg();
  if (orgs.length <= 1) return null;
  return (
    <div className="border-b border-border p-2">
      <select
        className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
        value={orgId ?? ''}
        onChange={(e) => setOrgId(e.target.value)}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AppShell() {
  const session = useSession();
  const invalidate = useInvalidateSession();
  const navigate = useNavigate();
  const setupStatus = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api<{ needsSetup: boolean }>('/setup/status'),
    enabled: session.data === null,
  });

  if (session.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (session.data === null) {
    if (setupStatus.data?.needsSetup) return <Navigate to="/setup" />;
    if (setupStatus.data) return <Navigate to="/login" />;
    return null;
  }

  const user = session.data;
  if (!user) return null;

  const logout = async () => {
    await post('/auth/logout');
    await invalidate();
    navigate({ to: '/login' });
  };

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
            Fe
          </div>
          <span className="font-semibold tracking-tight">fe2o3</span>
        </div>
        <OrgSwitcher />
        <nav className="flex-1 space-y-1 p-2">
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground',
                'hover:bg-accent hover:text-accent-foreground',
                '[&.active]:bg-accent [&.active]:font-medium [&.active]:text-accent-foreground',
              )}
              activeOptions={{ exact: to === '/' }}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="space-y-1 border-t border-border p-2">
          <Link
            to="/profile"
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground',
              'hover:bg-accent hover:text-accent-foreground',
              '[&.active]:bg-accent [&.active]:text-accent-foreground',
            )}
          >
            <User className="size-4" />
            <span className="truncate">{user.displayName || user.email}</span>
          </Link>
          <div className="flex items-center justify-between pl-1">
            <button
              type="button"
              onClick={logout}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
