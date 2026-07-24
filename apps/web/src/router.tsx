import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './components/app-shell';
import { CredentialsPage } from './pages/credentials';
import { DashboardPage } from './pages/dashboard';
import { DeviceDetailPage } from './pages/device-detail';
import { DevicesPage } from './pages/devices';
import { GroupsPage } from './pages/groups';
import { LoginPage } from './pages/login';
import { PlaceholderPage } from './pages/placeholder';
import { ProfilePage } from './pages/profile';
import { SetupPage } from './pages/setup';
import { UsersPage } from './pages/users';

const rootRoute = createRootRoute({
  component: Outlet,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: SetupPage,
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

const usersRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/users',
  component: UsersPage,
});

const profileRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/profile',
  component: ProfilePage,
});

const devicesRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/devices',
  component: DevicesPage,
});

const deviceDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/devices/$deviceId',
  component: DeviceDetailPage,
});

const groupsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/groups',
  component: GroupsPage,
});

const credentialsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/credentials',
  component: CredentialsPage,
});

const placeholder = <P extends string>(path: P, title: string) =>
  createRoute({
    getParentRoute: () => shellRoute,
    path,
    component: () => <PlaceholderPage title={title} />,
  });

const routeTree = rootRoute.addChildren([
  loginRoute,
  setupRoute,
  shellRoute.addChildren([
    indexRoute,
    usersRoute,
    profileRoute,
    devicesRoute,
    deviceDetailRoute,
    groupsRoute,
    credentialsRoute,
    placeholder('/jobs', 'Jobs'),
    placeholder('/hooks', 'Hooks'),
    placeholder('/settings', 'Settings'),
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
