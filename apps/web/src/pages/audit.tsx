import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

interface AuditEntry {
  id: string;
  userEmail: string | null;
  apiKeyId: string | null;
  action: string;
  resource: string;
  ip: string | null;
  createdAt: string;
}

export function AuditPage() {
  const session = useSession();
  const isSuper = session.data?.isSuperadmin ?? false;
  const entries = useQuery({
    queryKey: ['audit'],
    queryFn: () => api<AuditEntry[]>('/audit?limit=500'),
    enabled: isSuper,
  });

  if (!isSuper) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">The audit log requires superadmin access.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Every authenticated mutating API call, newest first
      </p>
      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Resource</th>
              <th className="px-4 py-2 font-medium">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {entries.data?.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-4 py-2">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  {e.userEmail ?? 'unknown'}
                  {e.apiKeyId && (
                    <span className="ml-1 rounded bg-muted px-1 text-xs text-muted-foreground">
                      api key
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
                <td className="max-w-md truncate px-4 py-2 font-mono text-xs">{e.resource}</td>
                <td className="px-4 py-2 text-muted-foreground">{e.ip ?? '—'}</td>
              </tr>
            ))}
            {entries.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No audit entries yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
