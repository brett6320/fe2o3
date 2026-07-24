import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useOrgEvents } from '@/lib/events';
import { useOrg } from '@/lib/org-context';
import { cn } from '@/lib/utils';

interface Stats {
  devices: number;
  enabled: number;
  success: number;
  failed: number;
  never: number;
  changesLast24h: number;
}
interface Job {
  id: string;
  deviceId: string;
  deviceName?: string;
  status: string;
  commitSha: string | null;
  error: string | null;
  createdAt: string;
}
interface Device {
  id: string;
  name: string;
  lastStatus: string;
  lastError: string | null;
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold', tone)}>{value}</div>
    </Card>
  );
}

export function DashboardPage() {
  const { orgId } = useOrg();
  useOrgEvents();

  const stats = useQuery({
    queryKey: ['stats', orgId],
    queryFn: () => api<Stats>(`/orgs/${orgId}/stats`),
    enabled: !!orgId,
  });
  const jobs = useQuery({
    queryKey: ['org-jobs', orgId],
    queryFn: () => api<Job[]>(`/orgs/${orgId}/jobs?limit=15`),
    enabled: !!orgId,
  });
  const devices = useQuery({
    queryKey: ['devices', orgId],
    queryFn: () => api<Device[]>(`/orgs/${orgId}/devices`),
    enabled: !!orgId,
  });
  const failing = devices.data?.filter((d) => d.lastStatus === 'failed') ?? [];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Network device configuration backup overview
      </p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Devices" value={stats.data?.devices ?? '…'} />
        <Stat label="Healthy" value={stats.data?.success ?? '…'} tone="text-success" />
        <Stat label="Failing" value={stats.data?.failed ?? '…'} tone="text-destructive" />
        <Stat label="Never backed up" value={stats.data?.never ?? '…'} />
        <Stat label="Changes (24h)" value={stats.data?.changesLast24h ?? '…'} tone="text-primary" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 font-medium">Recent activity</div>
          <ul className="divide-y divide-border">
            {jobs.data?.slice(0, 10).map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    j.status === 'success' && 'bg-success',
                    j.status === 'failed' && 'bg-destructive',
                    j.status === 'running' && 'animate-pulse bg-warning',
                  )}
                />
                <Link
                  to="/devices/$deviceId"
                  params={{ deviceId: j.deviceId }}
                  className="font-medium text-primary hover:underline"
                >
                  {j.deviceName ?? j.deviceId}
                </Link>
                <span className="text-muted-foreground">
                  {j.commitSha ? `changed (${j.commitSha.slice(0, 8)})` : j.status}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(j.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
            {jobs.data?.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                No backup activity yet
              </li>
            )}
          </ul>
        </Card>

        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 font-medium">Failing devices</div>
          <ul className="divide-y divide-border">
            {failing.map((d) => (
              <li key={d.id} className="px-4 py-2 text-sm">
                <Link
                  to="/devices/$deviceId"
                  params={{ deviceId: d.id }}
                  className="font-medium text-primary hover:underline"
                >
                  {d.name}
                </Link>
                <div className="truncate text-xs text-destructive">{d.lastError}</div>
              </li>
            ))}
            {failing.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-muted-foreground">
                All devices healthy
              </li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}
