import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';

interface DriverInfo {
  id: string;
  displayName: string;
  vars: { key: string; description: string; type: string }[];
}

export function ModelsPage() {
  const models = useQuery({ queryKey: ['models'], queryFn: () => api<DriverInfo[]>('/models') });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Device models</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Built-in vendor drivers, plus any plugins from the data directory (drivers/*.mjs)
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {models.data?.map((m) => (
          <Card key={m.id}>
            <div className="flex items-baseline justify-between">
              <h2 className="font-medium">{m.displayName}</h2>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{m.id}</code>
            </div>
            {m.vars.length > 0 && (
              <div className="mt-3 space-y-1">
                <div className="text-xs font-medium text-muted-foreground">Device variables</div>
                {m.vars.map((v) => (
                  <div key={v.key} className="text-xs text-muted-foreground">
                    <code className="text-foreground">{v.key}</code> — {v.description}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
