import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface Tenant {
  orgId: string;
  name: string;
  slug: string;
  devices: number;
  healthy: number;
  failing: number;
  never: number;
  disabled: number;
  lastBackupAt: string | null;
}
interface Failure {
  deviceId: string;
  deviceName: string;
  orgId: string;
  orgName: string;
  error: string | null;
  at: string;
}
interface Overview {
  totals: {
    tenants: number;
    devices: number;
    healthy: number;
    failing: number;
    never: number;
    disabled: number;
    changes24h: number;
  };
  tenants: Tenant[];
  recentFailures: Failure[];
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold', tone)}>{value}</div>
    </Card>
  );
}

export function OverviewPage() {
  const session = useSession();
  const { setOrgId } = useOrg();
  const isSuper = session.data?.isSuperadmin ?? false;

  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => api<Overview>('/admin/overview'),
    enabled: isSuper,
    refetchInterval: 15_000,
  });

  if (!isSuper) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          The global overview requires superadmin access.
        </p>
      </div>
    );
  }

  const t = overview.data?.totals;
  const withIssues = overview.data?.tenants.filter((x) => x.failing > 0 || x.never > 0) ?? [];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Global overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Health across all {t?.tenants ?? '…'} organizations
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Stat label="Tenants" value={t?.tenants ?? '…'} />
        <Stat label="Devices" value={t?.devices ?? '…'} />
        <Stat label="Failing" value={t?.failing ?? '…'} tone="text-destructive" />
        <Stat label="Never backed up" value={t?.never ?? '…'} />
        <Stat label="Disabled" value={t?.disabled ?? '…'} tone="text-warning" />
        <Stat label="Changes (24h)" value={t?.changes24h ?? '…'} tone="text-primary" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-medium">Tenants</span>
            <span className="text-xs text-muted-foreground">problems first</span>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Organization</th>
                  <th className="px-4 py-2 font-medium">Devices</th>
                  <th className="px-4 py-2 font-medium">Failing</th>
                  <th className="px-4 py-2 font-medium">Never</th>
                  <th className="px-4 py-2 font-medium">Disabled</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {overview.data?.tenants.map((row) => (
                  <tr
                    key={row.orgId}
                    className="cursor-pointer hover:bg-accent/50"
                    onClick={() => setOrgId(row.orgId)}
                    title="Switch to this org"
                  >
                    <td className="px-4 py-2">
                      <span className="font-medium">{row.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{row.slug}</span>
                    </td>
                    <td className="px-4 py-2">{row.devices}</td>
                    <td
                      className={cn('px-4 py-2', row.failing > 0 && 'font-medium text-destructive')}
                    >
                      {row.failing}
                    </td>
                    <td className="px-4 py-2">{row.never}</td>
                    <td className={cn('px-4 py-2', row.disabled > 0 && 'text-warning')}>
                      {row.disabled}
                    </td>
                  </tr>
                ))}
                {overview.data?.tenants.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No organizations yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 font-medium">
            Recent failures (all tenants)
          </div>
          <ul className="max-h-[60vh] divide-y divide-border overflow-auto">
            {overview.data?.recentFailures.map((f) => (
              <li key={`${f.deviceId}-${f.at}`} className="px-4 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.deviceName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {f.orgName} · {new Date(f.at).toLocaleString()}
                  </span>
                </div>
                <div className="truncate text-xs text-destructive">{f.error}</div>
              </li>
            ))}
            {overview.data?.recentFailures.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No recent failures
              </li>
            )}
          </ul>
        </Card>
      </div>

      {withIssues.length === 0 && overview.data && (
        <p className="mt-4 text-sm text-success">All tenants healthy.</p>
      )}
    </div>
  );
}
