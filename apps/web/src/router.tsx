import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { AppShell } from './components/app-shell';
import { ApiKeysPage } from './pages/api-keys';
import { AuditPage } from './pages/audit';
import { CredentialsPage } from './pages/credentials';
import { DashboardPage } from './pages/dashboard';
import { DeviceDetailPage } from './pages/device-detail';
import { DevicesPage } from './pages/devices';
import { GroupsPage } from './pages/groups';
import { HooksPage } from './pages/hooks';
import { JobsPage } from './pages/jobs';
import { LoginPage } from './pages/login';
import { ModelsPage } from './pages/models';
import { OrgsPage } from './pages/orgs';
import { OverviewPage } from './pages/overview';
import { ProfilePage } from './pages/profile';
import { SettingsPage } from './pages/settings';
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
  validateSearch: (search: Record<string, unknown>): { sha?: string } =>
    typeof search.sha === 'string' ? { sha: search.sha } : {},
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

const jobsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/jobs',
  component: JobsPage,
});

const modelsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/models',
  component: ModelsPage,
});

const auditRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/audit',
  component: AuditPage,
});

const overviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/overview',
  component: OverviewPage,
});

const orgsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/orgs',
  component: OrgsPage,
});

const apiKeysRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/api-keys',
  component: ApiKeysPage,
});

const hooksRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/hooks',
  component: HooksPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: SettingsPage,
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
    jobsRoute,
    modelsRoute,
    apiKeysRoute,
    auditRoute,
    overviewRoute,
    orgsRoute,
    hooksRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
