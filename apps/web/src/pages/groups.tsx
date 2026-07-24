import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, post } from '@/lib/api';
import { useOrg } from '@/lib/org';

interface Group {
  id: string;
  name: string;
  pathSlug: string;
  defaultCredentialId: string | null;
  defaultIntervalSec: number;
  deviceCount?: number;
}

interface Credential {
  id: string;
  name: string;
}

export function GroupsPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', pathSlug: '', defaultCredentialId: '' });

  const groups = useQuery({
    queryKey: ['groups', orgId],
    queryFn: () => api<Group[]>(`/orgs/${orgId}/groups`),
    enabled: !!orgId,
  });
  const creds = useQuery({
    queryKey: ['credentials', orgId],
    queryFn: () => api<Credential[]>(`/orgs/${orgId}/credentials`),
    enabled: !!orgId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['groups', orgId] });
  const create = useMutation({
    mutationFn: () =>
      post<Group>(`/orgs/${orgId}/groups`, {
        name: form.name,
        pathSlug: form.pathSlug,
        defaultCredentialId: form.defaultCredentialId || null,
      }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setForm({ name: '', pathSlug: '', defaultCredentialId: '' });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/orgs/${orgId}/groups/${id}`),
    onSuccess: invalidate,
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Device groups map to directories in the org's git repository
          </p>
        </div>
        {role === 'admin' && (
          <Button onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : 'Add group'}
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="g-name">Name</Label>
                <Input
                  id="g-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="g-slug">Path slug</Label>
                <Input
                  id="g-slug"
                  required
                  pattern="[a-z0-9][a-z0-9-]*"
                  placeholder="core"
                  value={form.pathSlug}
                  onChange={(e) => setForm((f) => ({ ...f, pathSlug: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="g-cred">Default credential</Label>
              <select
                id="g-cred"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={form.defaultCredentialId}
                onChange={(e) => setForm((f) => ({ ...f, defaultCredentialId: e.target.value }))}
              >
                <option value="">None</option>
                {creds.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending}>
              Create group
            </Button>
          </form>
        </Card>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Path</th>
              <th className="px-4 py-2 font-medium">Devices</th>
              <th className="px-4 py-2 font-medium">Default interval</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {groups.data?.map((g) => (
              <tr key={g.id}>
                <td className="px-4 py-2 font-medium">{g.name}</td>
                <td className="px-4 py-2 font-mono text-xs">{g.pathSlug}/</td>
                <td className="px-4 py-2">{g.deviceCount ?? 0}</td>
                <td className="px-4 py-2">{Math.round(g.defaultIntervalSec / 60)} min</td>
                <td className="px-4 py-2 text-right">
                  {role === 'admin' && (
                    <Button variant="destructive" onClick={() => remove.mutate(g.id)}>
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {groups.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No groups yet — create one before adding devices
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
