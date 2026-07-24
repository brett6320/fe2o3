import { useQuery } from '@tanstack/react-query';

export function DashboardPage() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('/api/v1/health');
      if (!res.ok) throw new Error(`health check failed: ${res.status}`);
      return (await res.json()) as { status: string; version: string; uptime: number };
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Network device configuration backup overview
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Server</div>
          <div className="mt-1 text-2xl font-semibold">
            {health.isLoading ? '…' : health.data ? 'Online' : 'Offline'}
          </div>
          {health.data && (
            <div className="mt-1 text-xs text-muted-foreground">
              v{health.data.version} · up {Math.floor(health.data.uptime)}s
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
