import { Link, Outlet } from '@tanstack/react-router';
import {
  Activity,
  KeyRound,
  LayoutDashboard,
  Moon,
  Router,
  Settings,
  Sun,
  Users,
  Webhook,
} from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/devices', label: 'Devices', icon: Router },
  { to: '/jobs', label: 'Jobs', icon: Activity },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
  { to: '/hooks', label: 'Hooks', icon: Webhook },
  { to: '/users', label: 'Users', icon: Users },
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

export function AppShell() {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary font-mono text-sm font-bold text-primary-foreground">
            Fe
          </div>
          <span className="font-semibold tracking-tight">fe2o3</span>
        </div>
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
        <div className="flex items-center justify-between border-t border-border p-2 pl-4">
          <span className="text-xs text-muted-foreground">v0.1.0</span>
          <ThemeToggle />
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
