import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './components/app-shell';
import { DashboardPage } from './pages/dashboard';
import { PlaceholderPage } from './pages/placeholder';

const rootRoute = createRootRoute({
  component: Outlet,
});

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  component: DashboardPage,
});

const placeholder = <P extends string>(path: P, title: string) =>
  createRoute({
    getParentRoute: () => shellRoute,
    path,
    component: () => <PlaceholderPage title={title} />,
  });

const routeTree = rootRoute.addChildren([
  shellRoute.addChildren([
    indexRoute,
    placeholder('/devices', 'Devices'),
    placeholder('/jobs', 'Jobs'),
    placeholder('/credentials', 'Credentials'),
    placeholder('/hooks', 'Hooks'),
    placeholder('/users', 'Users'),
    placeholder('/settings', 'Settings'),
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
