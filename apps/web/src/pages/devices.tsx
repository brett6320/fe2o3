import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, post } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
import { cn } from '@/lib/utils';

export interface Device {
  id: string;
  name: string;
  host: string;
  port: number | null;
  protocol: 'ssh' | 'telnet';
  modelId: string;
  groupId: string;
  credentialId: string | null;
  intervalSec: number | null;
  enabled: boolean;
  lastStatus: 'never' | 'running' | 'success' | 'failed';
  lastBackupAt: string | null;
  lastError: string | null;
}

interface Group {
  id: string;
  name: string;
}
interface Credential {
  id: string;
  name: string;
}
interface DriverInfo {
  id: string;
  displayName: string;
}

export function statusDot(status: Device['lastStatus']) {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full',
        status === 'success' && 'bg-success',
        status === 'failed' && 'bg-destructive',
        status === 'running' && 'animate-pulse bg-warning',
        status === 'never' && 'bg-muted-foreground/40',
      )}
    />
  );
}

export function DevicesPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    host: '',
    port: '',
    modelId: 'ios',
    groupId: '',
    credentialId: '',
    backupNow: false,
  });

  const devices = useQuery({
    queryKey: ['devices', orgId],
    queryFn: () => api<Device[]>(`/orgs/${orgId}/devices`),
    enabled: !!orgId,
    refetchInterval: 10_000,
  });
  const groups = useQuery({
    queryKey: ['groups', orgId],
    queryFn: () => api<Group[]>(`/orgs/${orgId}/groups`),
    enabled: !!orgId,
  });
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api<DriverInfo[]>('/models'),
  });
  const creds = useQuery({
    queryKey: ['credentials', orgId],
    queryFn: () => api<Credential[]>(`/orgs/${orgId}/credentials`),
    enabled: !!orgId,
  });

  const create = useMutation({
    mutationFn: () =>
      post<Device>(`/orgs/${orgId}/devices`, {
        name: form.name,
        host: form.host,
        port: form.port ? Number(form.port) : null,
        modelId: form.modelId,
        groupId: form.groupId || groups.data?.[0]?.id,
        credentialId: form.credentialId || null,
        backupNow: form.backupNow,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices', orgId] });
      setShowCreate(false);
      setForm({
        name: '',
        host: '',
        port: '',
        modelId: 'ios',
        groupId: '',
        credentialId: '',
        backupNow: false,
      });
    },
  });

  const groupName = (id: string) => groups.data?.find((g) => g.id === id)?.name ?? '—';
  const filtered = devices.data?.filter(
    (d) =>
      d.name.toLowerCase().includes(filter.toLowerCase()) ||
      d.host.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {devices.data?.length ?? 0} devices under backup
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter…"
            className="w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {role === 'admin' && (
            <Button onClick={() => setShowCreate((s) => !s)}>
              {showCreate ? 'Cancel' : 'Add device'}
            </Button>
          )}
        </div>
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
                <Label htmlFor="d-name">Name</Label>
                <Input
                  id="d-name"
                  required
                  placeholder="core-sw1"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-host">Host</Label>
                <Input
                  id="d-host"
                  required
                  placeholder="10.0.0.1"
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-port">Port (default 22)</Label>
                <Input
                  id="d-port"
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-model">Model</Label>
                <select
                  id="d-model"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.modelId}
                  onChange={(e) => setForm((f) => ({ ...f, modelId: e.target.value }))}
                >
                  {models.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-cred">Credential</Label>
                <select
                  id="d-cred"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.credentialId}
                  onChange={(e) => setForm((f) => ({ ...f, credentialId: e.target.value }))}
                >
                  <option value="">Group default</option>
                  {creds.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-group">Group</Label>
                <select
                  id="d-group"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={form.groupId}
                  onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
                >
                  {groups.data?.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.backupNow}
                onChange={(e) => setForm((f) => ({ ...f, backupNow: e.target.checked }))}
              />
              Back up immediately after adding
            </label>
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending || groups.data?.length === 0}>
              Add device
            </Button>
            {groups.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">Create a group first.</p>
            )}
          </form>
        </Card>
      )}

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Host</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Group</th>
              <th className="px-4 py-2 font-medium">Last backup</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {filtered?.map((d) => (
              <tr key={d.id} className="hover:bg-accent/50">
                <td className="px-4 py-2">{statusDot(d.lastStatus)}</td>
                <td className="px-4 py-2">
                  <Link
                    to="/devices/$deviceId"
                    params={{ deviceId: d.id }}
                    className="font-medium text-primary hover:underline"
                  >
                    {d.name}
                  </Link>
                </td>
                <td className="px-4 py-2 font-mono text-xs">
                  {d.host}
                  {d.port ? `:${d.port}` : ''}
                </td>
                <td className="px-4 py-2">{d.modelId}</td>
                <td className="px-4 py-2">{groupName(d.groupId)}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {d.lastBackupAt ? new Date(d.lastBackupAt).toLocaleString() : 'never'}
                </td>
              </tr>
            ))}
            {filtered?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No devices
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
