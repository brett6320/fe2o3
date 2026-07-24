import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, post } from '@/lib/api';
import { useOrg } from '@/lib/org';

interface Credential {
  id: string;
  name: string;
  username: string;
  hasPassword: boolean;
  hasEnablePassword: boolean;
  hasSshKey: boolean;
}

export function CredentialsPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', username: '', password: '', enablePassword: '' });

  const creds = useQuery({
    queryKey: ['credentials', orgId],
    queryFn: () => api<Credential[]>(`/orgs/${orgId}/credentials`),
    enabled: !!orgId,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['credentials', orgId] });

  const create = useMutation({
    mutationFn: () => post<Credential>(`/orgs/${orgId}/credentials`, form),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setForm({ name: '', username: '', password: '', enablePassword: '' });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/orgs/${orgId}/credentials/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Credentials</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Login secrets for device access — values are write-only
          </p>
        </div>
        {role === 'admin' && (
          <Button onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : 'Add credential'}
          </Button>
        )}
      </div>

      {showCreate && (
        <Card className="mt-4 max-w-md">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="c-name">Name</Label>
              <Input
                id="c-name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-user">Username</Label>
              <Input
                id="c-user"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-pass">Password</Label>
              <Input
                id="c-pass"
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-enable">Enable password (optional)</Label>
              <Input
                id="c-enable"
                type="password"
                value={form.enablePassword}
                onChange={(e) => setForm((f) => ({ ...f, enablePassword: e.target.value }))}
              />
            </div>
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending}>
              Create credential
            </Button>
          </form>
        </Card>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Username</th>
              <th className="px-4 py-2 font-medium">Secrets</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {creds.data?.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2">{c.username || '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {[
                    c.hasPassword && 'password',
                    c.hasEnablePassword && 'enable',
                    c.hasSshKey && 'ssh key',
                  ]
                    .filter(Boolean)
                    .join(', ') || 'none'}
                </td>
                <td className="px-4 py-2 text-right">
                  {role === 'admin' && (
                    <Button variant="destructive" onClick={() => remove.mutate(c.id)}>
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {creds.data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No credentials yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
