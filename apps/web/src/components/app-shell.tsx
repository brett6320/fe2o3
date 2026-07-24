import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useNavigate } from '@tanstack/react-router';
import {
  Activity,
  Braces,
  Building2,
  Cpu,
  FolderTree,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeft,
  PanelLeftClose,
  Router,
  ScrollText,
  Settings,
  Sun,
  User,
  Users,
  Webhook,
  X,
} from 'lucide-react';
import { type ComponentType, useState } from 'react';
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

const COLLAPSE_KEY = 'fe2o3-nav-collapsed';

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
  exact,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  collapsed: boolean;
  exact?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground',
        'hover:bg-accent hover:text-accent-foreground',
        '[&.active]:bg-accent [&.active]:font-medium [&.active]:text-accent-foreground',
        // Collapse only applies on desktop; the mobile drawer is always full-width.
        collapsed && 'md:justify-center md:gap-0 md:px-0',
      )}
      activeOptions={{ exact: exact ?? false }}
    >
      <Icon className="size-4 shrink-0" />
      <span className={cn('truncate', collapsed && 'md:hidden')}>{label}</span>
    </Link>
  );
}

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

function OrgSwitcher({ className }: { className?: string }) {
  const { orgId, orgs, setOrgId } = useOrg();
  if (orgs.length <= 1) return null;
  return (
    <div className={cn('border-b border-border p-2', className)}>
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  };
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

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="flex min-h-screen">
      {/* Mobile drawer backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={closeMobile}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card',
          'transition-transform duration-200 md:static md:z-auto md:w-56 md:translate-x-0 md:transition-[width]',
          collapsed && 'md:w-16',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-3">
          <div className={cn('flex items-center gap-2', collapsed && 'md:hidden')}>
            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
              Fe
            </div>
            <span className="font-semibold tracking-tight">Fe2O3</span>
          </div>
          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'hidden rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:block',
              collapsed ? 'md:mx-auto' : 'md:ml-auto',
            )}
          >
            {collapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
          </button>
          {/* Mobile close button */}
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close navigation"
            className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground md:hidden"
          >
            <X className="size-4" />
          </button>
        </div>
        <OrgSwitcher className={cn(collapsed && 'md:hidden')} />
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {user.isSuperadmin && (
            <NavItem
              to="/overview"
              label="Overview"
              icon={Globe}
              collapsed={collapsed}
              onNavigate={closeMobile}
            />
          )}
          {nav.map(({ to, label, icon }) => (
            <NavItem
              key={to}
              to={to}
              label={label}
              icon={icon}
              collapsed={collapsed}
              exact={to === '/'}
              onNavigate={closeMobile}
            />
          ))}
        </nav>
        <div className="space-y-1 border-t border-border p-2">
          <NavItem
            to="/profile"
            label={user.displayName || user.email}
            icon={User}
            collapsed={collapsed}
            onNavigate={closeMobile}
          />
          <div
            className={cn(
              'flex items-center justify-between pl-1',
              collapsed && 'md:flex-col md:justify-center md:gap-1 md:pl-0',
            )}
          >
            <button
              type="button"
              onClick={logout}
              title={collapsed ? 'Sign out' : undefined}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <LogOut className="size-4 shrink-0" />
              <span className={cn(collapsed && 'md:hidden')}>Sign out</span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <Menu className="size-5" />
          </button>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
            Fe
          </div>
          <span className="font-semibold tracking-tight">Fe2O3</span>
        </header>
        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
