import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, post } from '@/lib/api';
import { useOrg } from '@/lib/org-context';

interface Hook {
  id: string;
  name: string;
  events: string[];
  type: 'webhook' | 'slack';
  config: Record<string, string>;
  enabled: boolean;
}

const EVENTS = ['backup_changed', 'backup_failed', 'backup_success'] as const;

export function HooksPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'webhook' as 'webhook' | 'slack',
    url: '',
    secret: '',
    events: ['backup_changed', 'backup_failed'] as string[],
  });
  const [testResult, setTestResult] = useState<string | null>(null);

  const hooksQuery = useQuery({
    queryKey: ['hooks', orgId],
    queryFn: () => api<Hook[]>(`/orgs/${orgId}/hooks`),
    enabled: !!orgId,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['hooks', orgId] });

  const create = useMutation({
    mutationFn: () =>
      post<Hook>(`/orgs/${orgId}/hooks`, {
        name: form.name,
        type: form.type,
        events: form.events,
        config: { url: form.url, ...(form.secret ? { secret: form.secret } : {}) },
      }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/orgs/${orgId}/hooks/${id}`),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: (id: string) =>
      post<{ ok: boolean; error?: string }>(`/orgs/${orgId}/hooks/${id}/test`),
    onSuccess: (r) => setTestResult(r.ok ? 'Test delivery sent.' : `Failed: ${r.error}`),
  });

  const toggleEvent = (event: string) =>
    setForm((f) => ({
      ...f,
      events: f.events.includes(event) ? f.events.filter((e) => e !== event) : [...f.events, event],
    }));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Notify external systems when backups change or fail
          </p>
        </div>
        {role === 'admin' && (
          <Button onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : 'Add hook'}
          </Button>
        )}
      </div>

      {showCreate && (
        <Card className="mt-4 max-w-lg">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="h-name">Name</Label>
                <Input
                  id="h-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="h-type">Type</Label>
                <select
                  id="h-type"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.type}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, type: e.target.value as 'webhook' | 'slack' }))
                  }
                >
                  <option value="webhook">Webhook (JSON + HMAC)</option>
                  <option value="slack">Slack incoming webhook</option>
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="h-url">URL</Label>
              <Input
                id="h-url"
                type="url"
                required
                placeholder="https://…"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            {form.type === 'webhook' && (
              <div className="space-y-2">
                <Label htmlFor="h-secret">HMAC secret (optional)</Label>
                <Input
                  id="h-secret"
                  value={form.secret}
                  onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Events</Label>
              <div className="flex gap-4">
                {EVENTS.map((ev) => (
                  <label key={ev} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.events.includes(ev)}
                      onChange={() => toggleEvent(ev)}
                    />
                    {ev.replace('backup_', '')}
                  </label>
                ))}
              </div>
            </div>
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending || form.events.length === 0}>
              Create hook
            </Button>
          </form>
        </Card>
      )}

      {testResult && <p className="mt-3 text-sm text-muted-foreground">{testResult}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Events</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {hooksQuery.data?.map((h) => (
              <tr key={h.id}>
                <td className="px-4 py-2 font-medium">{h.name}</td>
                <td className="px-4 py-2">{h.type}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {h.events.map((e) => e.replace('backup_', '')).join(', ')}
                </td>
                <td className="px-4 py-2 text-right">
                  {role === 'admin' && (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => test.mutate(h.id)}>
                        Test
                      </Button>
                      <Button variant="destructive" onClick={() => remove.mutate(h.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {hooksQuery.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No hooks configured
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
