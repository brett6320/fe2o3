import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, patch, post } from '@/lib/api';
import { useOrg } from '@/lib/org';
import { cn } from '@/lib/utils';
import { type Device, statusDot } from './devices';

interface Version {
  sha: string;
  date: string;
  subject: string;
}
interface Job {
  id: string;
  trigger: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  commitSha: string | null;
  createdAt: string;
}

type Tab = 'config' | 'versions' | 'jobs' | 'edit';

function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="p-4 text-sm text-muted-foreground">No differences.</p>;
  return (
    <pre className="overflow-x-auto p-4 font-mono text-xs leading-5">
      {diff.split('\n').map((line, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static diff lines
          key={i}
          className={cn(
            line.startsWith('+') && !line.startsWith('+++') && 'bg-success/15 text-success',
            line.startsWith('-') && !line.startsWith('---') && 'bg-destructive/15 text-destructive',
            line.startsWith('@@') && 'text-primary',
            (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) &&
              'text-muted-foreground',
          )}
        >
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

export function DeviceDetailPage() {
  const { deviceId } = useParams({ strict: false }) as { deviceId: string };
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { sha?: string };
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('config');
  const [selectedSha, setSelectedShaState] = useState<string | null>(search.sha ?? null);
  // keep the sha in the URL so specific versions are linkable
  const setSelectedSha = (sha: string | null) => {
    setSelectedShaState(sha);
    navigate({
      to: '.',
      search: sha ? { sha } : {},
      replace: true,
    });
  };
  const [diffFrom, setDiffFrom] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  const base = `/orgs/${orgId}/devices/${deviceId}`;
  const device = useQuery({
    queryKey: ['device', orgId, deviceId],
    queryFn: () => api<Device>(base),
    enabled: !!orgId,
    refetchInterval: 10_000,
  });
  const versions = useQuery({
    queryKey: ['versions', orgId, deviceId],
    queryFn: () => api<Version[]>(`${base}/versions`),
    enabled: !!orgId,
  });
  const latestSha = versions.data?.[0]?.sha ?? null;
  const sha = selectedSha ?? latestSha;
  const config = useQuery({
    queryKey: ['config', orgId, deviceId, sha],
    queryFn: () => api<{ content: string }>(`${base}/versions/${sha}`),
    enabled: !!orgId && !!sha,
  });
  const diff = useQuery({
    queryKey: ['diff', orgId, deviceId, diffFrom, sha],
    queryFn: () => api<{ diff: string }>(`${base}/diff?from=${diffFrom}&to=${sha}`),
    enabled: !!orgId && !!sha && !!diffFrom && diffFrom !== sha,
  });
  const jobs = useQuery({
    queryKey: ['jobs', orgId, deviceId],
    queryFn: () => api<Job[]>(`${base}/jobs`),
    enabled: !!orgId,
    refetchInterval: 10_000,
  });
  const jobDetail = useQuery({
    queryKey: ['job', orgId, openJob],
    queryFn: () => api<Job & { log: string | null }>(`/orgs/${orgId}/jobs/${openJob}`),
    enabled: !!orgId && !!openJob && role !== 'readonly',
  });

  const backup = useMutation({
    mutationFn: () => post<{ status: string; error?: string }>(`${base}/backup`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', orgId, deviceId] });
      qc.invalidateQueries({ queryKey: ['versions', orgId, deviceId] });
      qc.invalidateQueries({ queryKey: ['jobs', orgId, deviceId] });
    },
  });

  const d = device.data;
  if (!d) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            {statusDot(d.lastStatus)}
            <h1 className="text-2xl font-semibold tracking-tight">{d.name}</h1>
          </div>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {d.host}
            {d.port ? `:${d.port}` : ''} · {d.modelId} · {d.protocol}
          </p>
          {d.lastError && <p className="mt-1 text-sm text-destructive">{d.lastError}</p>}
        </div>
        {(role === 'admin' || role === 'operator') && (
          <Button onClick={() => backup.mutate()} disabled={backup.isPending}>
            {backup.isPending ? 'Backing up…' : 'Backup now'}
          </Button>
        )}
      </div>
      {backup.data?.error && <ErrorText>{backup.data.error}</ErrorText>}

      <div className="mt-6 flex gap-1 border-b border-border">
        {(
          [
            ...(['config', 'versions', 'jobs'] as const),
            ...(role === 'admin' ? (['edit'] as const) : []),
          ] as Tab[]
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm capitalize',
              tab === t
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'config' && (
        <Card className="mt-4 p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm text-muted-foreground">
              {sha ? `Version ${sha.slice(0, 8)}` : 'No backups yet'}
            </span>
            {versions.data && versions.data.length > 0 && (
              <select
                className="rounded-md border border-input bg-transparent px-2 py-1 text-sm"
                value={sha ?? ''}
                onChange={(e) => setSelectedSha(e.target.value)}
              >
                {versions.data.map((v) => (
                  <option key={v.sha} value={v.sha}>
                    {v.sha.slice(0, 8)} — {new Date(v.date).toLocaleString()}
                  </option>
                ))}
              </select>
            )}
          </div>
          <pre className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-5">
            {config.data?.content ?? 'No configuration stored yet — run a backup.'}
          </pre>
        </Card>
      )}

      {tab === 'versions' && (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <Card className="p-0">
            <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
              Select two versions to compare
            </div>
            <ul className="max-h-[60vh] divide-y divide-border overflow-auto">
              {versions.data?.map((v) => (
                <li key={v.sha}>
                  <button
                    type="button"
                    className={cn(
                      'w-full px-4 py-2 text-left text-sm hover:bg-accent',
                      (v.sha === diffFrom || v.sha === sha) && 'bg-accent',
                    )}
                    onClick={() => {
                      if (diffFrom === v.sha) setDiffFrom(null);
                      else if (sha === v.sha) setSelectedSha(null);
                      else if (!diffFrom) setDiffFrom(v.sha);
                      else setSelectedSha(v.sha);
                    }}
                  >
                    <span className="font-mono text-xs">{v.sha.slice(0, 8)}</span>
                    <span className="ml-2 text-muted-foreground">
                      {new Date(v.date).toLocaleString()}
                    </span>
                    <div className="truncate text-xs text-muted-foreground">{v.subject}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-0">
            <div className="border-b border-border px-4 py-2 text-sm text-muted-foreground">
              {diffFrom && sha && diffFrom !== sha
                ? `${diffFrom.slice(0, 8)} → ${sha.slice(0, 8)}`
                : 'Pick an older version on the left'}
            </div>
            <div className="max-h-[60vh] overflow-auto">
              {diff.data ? <DiffView diff={diff.data.diff} /> : null}
            </div>
          </Card>
        </div>
      )}

      {tab === 'edit' && role === 'admin' && <DeviceEditForm device={d} />}

      {tab === 'jobs' && (
        <Card className="mt-4 p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Trigger</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Commit</th>
                <th className="px-4 py-2 font-medium">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {jobs.data?.map((j) => (
                <tr
                  key={j.id}
                  className={cn(role !== 'readonly' && 'cursor-pointer hover:bg-accent/50')}
                  onClick={() => role !== 'readonly' && setOpenJob(openJob === j.id ? null : j.id)}
                >
                  <td className="px-4 py-2">{new Date(j.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2">{j.trigger}</td>
                  <td
                    className={cn(
                      'px-4 py-2',
                      j.status === 'success' && 'text-success',
                      j.status === 'failed' && 'text-destructive',
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
            </tbody>
          </table>
          {openJob && jobDetail.data?.log && (
            <div className="border-t border-border">
              <div className="px-4 py-2 text-sm text-muted-foreground">Session transcript</div>
              <pre className="max-h-96 overflow-auto bg-muted/30 p-4 font-mono text-xs leading-5">
                {jobDetail.data.log}
              </pre>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

interface Option {
  id: string;
  name: string;
}

function DeviceEditForm({ device }: { device: Device }) {
  const { orgId } = useOrg();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: device.name,
    host: device.host,
    port: device.port?.toString() ?? '',
    protocol: device.protocol,
    modelId: device.modelId,
    groupId: device.groupId,
    credentialId: device.credentialId ?? '',
    intervalSec: device.intervalSec?.toString() ?? '',
    enabled: device.enabled,
  });
  useEffect(() => {
    setForm({
      name: device.name,
      host: device.host,
      port: device.port?.toString() ?? '',
      protocol: device.protocol,
      modelId: device.modelId,
      groupId: device.groupId,
      credentialId: device.credentialId ?? '',
      intervalSec: device.intervalSec?.toString() ?? '',
      enabled: device.enabled,
    });
  }, [device]);

  const groups = useQuery({
    queryKey: ['groups', orgId],
    queryFn: () => api<Option[]>(`/orgs/${orgId}/groups`),
    enabled: !!orgId,
  });
  const creds = useQuery({
    queryKey: ['credentials', orgId],
    queryFn: () => api<Option[]>(`/orgs/${orgId}/credentials`),
    enabled: !!orgId,
  });
  const models = useQuery({
    queryKey: ['models'],
    queryFn: () => api<{ id: string; displayName: string }[]>('/models'),
  });

  const save = useMutation({
    mutationFn: () =>
      patch<Device>(`/orgs/${orgId}/devices/${device.id}`, {
        name: form.name,
        host: form.host,
        port: form.port ? Number(form.port) : null,
        protocol: form.protocol,
        modelId: form.modelId,
        groupId: form.groupId,
        credentialId: form.credentialId || null,
        intervalSec: form.intervalSec ? Number(form.intervalSec) : null,
        enabled: form.enabled,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device', orgId, device.id] });
      qc.invalidateQueries({ queryKey: ['devices', orgId] });
      qc.invalidateQueries({ queryKey: ['versions', orgId, device.id] });
    },
  });

  const select = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm';

  return (
    <Card className="mt-4 max-w-lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="e-name">Name</Label>
            <Input
              id="e-name"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-host">Host</Label>
            <Input
              id="e-host"
              required
              value={form.host}
              onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-port">Port (blank = default)</Label>
            <Input
              id="e-port"
              type="number"
              value={form.port}
              onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-protocol">Protocol</Label>
            <select
              id="e-protocol"
              className={select}
              value={form.protocol}
              onChange={(e) =>
                setForm((f) => ({ ...f, protocol: e.target.value as 'ssh' | 'telnet' }))
              }
            >
              <option value="ssh">ssh</option>
              <option value="telnet">telnet</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="e-model">Model</Label>
            <select
              id="e-model"
              className={select}
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
            <Label htmlFor="e-group">Group</Label>
            <select
              id="e-group"
              className={select}
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
          <div className="space-y-2">
            <Label htmlFor="e-cred">Credential</Label>
            <select
              id="e-cred"
              className={select}
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
            <Label htmlFor="e-interval">Interval seconds (blank = group default)</Label>
            <Input
              id="e-interval"
              type="number"
              min={60}
              value={form.intervalSec}
              onChange={(e) => setForm((f) => ({ ...f, intervalSec: e.target.value }))}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          Scheduled backups enabled
        </label>
        <ErrorText>{save.error?.message}</ErrorText>
        {save.isSuccess && <p className="text-sm text-success">Saved.</p>}
        <Button type="submit" disabled={save.isPending}>
          Save changes
        </Button>
      </form>
    </Card>
  );
}
