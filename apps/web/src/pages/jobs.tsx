import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api';
import { useOrgEvents } from '@/lib/events';
import { useOrg } from '@/lib/org-context';
import { cn } from '@/lib/utils';

interface Job {
  id: string;
  deviceId: string;
  deviceName?: string;
  trigger: string;
  status: string;
  error: string | null;
  commitSha: string | null;
  createdAt: string;
}

export function JobsPage() {
  const { orgId } = useOrg();
  useOrgEvents();
  const jobs = useQuery({
    queryKey: ['org-jobs', orgId],
    queryFn: () => api<Job[]>(`/orgs/${orgId}/jobs?limit=200`),
    enabled: !!orgId,
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
      <p className="mt-1 text-sm text-muted-foreground">Backup job history for this organization</p>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Device</th>
              <th className="px-4 py-2 font-medium">Trigger</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Change</th>
              <th className="px-4 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {jobs.data?.map((j) => (
              <tr key={j.id}>
                <td className="px-4 py-2 whitespace-nowrap">
                  {new Date(j.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  <Link
                    to="/devices/$deviceId"
                    params={{ deviceId: j.deviceId }}
                    className="text-primary hover:underline"
                  >
                    {j.deviceName ?? j.deviceId}
                  </Link>
                </td>
                <td className="px-4 py-2">{j.trigger}</td>
                <td
                  className={cn(
                    'px-4 py-2',
                    j.status === 'success' && 'text-success',
                    j.status === 'failed' && 'text-destructive',
                    j.status === 'running' && 'text-warning',
                  )}
                >
                  {j.status}
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {j.commitSha ? j.commitSha.slice(0, 8) : '—'}
                </td>
                <td className="max-w-md truncate px-4 py-2 text-destructive">{j.error ?? ''}</td>
              </tr>
            ))}
            {jobs.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No jobs yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
