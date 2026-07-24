import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, post } from '@/lib/api';

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write' | 'admin';
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export function ApiKeysPage() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api<ApiKey[]>('/api-keys') });
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write' | 'admin'>('read');
  const [newToken, setNewToken] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['api-keys'] });
  const create = useMutation({
    mutationFn: () => post<ApiKey & { token: string }>('/api-keys', { name, scope }),
    onSuccess: (data) => {
      setNewToken(data.token);
      setName('');
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api-keys/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Bearer tokens for the REST API — docs at{' '}
        <a href="/api/docs" className="text-primary hover:underline">
          /api/docs
        </a>
      </p>

      <Card className="mt-4 max-w-lg">
        <form
          className="flex items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="k-name">Name</Label>
            <Input
              id="k-name"
              required
              placeholder="ci-automation"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="k-scope">Scope</Label>
            <select
              id="k-scope"
              className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
            >
              <option value="read">read</option>
              <option value="write">write</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <Button type="submit" disabled={create.isPending}>
            Create
          </Button>
        </form>
        <ErrorText>{create.error?.message}</ErrorText>
        {newToken && (
          <div className="mt-4 rounded-md border border-warning/50 bg-warning/10 p-3">
            <p className="text-sm font-medium">Copy this token now — it won't be shown again:</p>
            <code className="mt-2 block break-all rounded bg-muted p-2 text-xs">{newToken}</code>
          </div>
        )}
      </Card>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Prefix</th>
              <th className="px-4 py-2 font-medium">Scope</th>
              <th className="px-4 py-2 font-medium">Last used</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {keys.data?.map((k) => (
              <tr key={k.id}>
                <td className="px-4 py-2 font-medium">{k.name}</td>
                <td className="px-4 py-2 font-mono text-xs">fe2o3_{k.prefix}_…</td>
                <td className="px-4 py-2">{k.scope}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
                </td>
                <td className="px-4 py-2 text-right">
                  <Button variant="destructive" onClick={() => remove.mutate(k.id)}>
                    Revoke
                  </Button>
                </td>
              </tr>
            ))}
            {keys.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No API keys
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
