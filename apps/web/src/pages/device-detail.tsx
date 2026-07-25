import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { ApiError, api, patch, post } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
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
interface InventoryItem {
  name: string;
  description?: string;
  pid?: string;
  serial?: string;
  /** Tree depth (0 = top level); nested components are indented by this. */
  depth: number;
}
interface FactsResponse {
  hasConfig: boolean;
  latestSha: string | null;
  facts: {
    serial?: string;
    model?: string;
    osVersion?: string;
    inventory?: InventoryItem[];
  } | null;
}

type Tab = 'overview' | 'config' | 'versions' | 'jobs' | 'edit';

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

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || '—'}</dd>
    </div>
  );
}

function humanizeDuration(sec: number): string {
  const w = Math.floor(sec / 604800);
  const d = Math.floor((sec % 604800) / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (w) parts.push(`${w}w`);
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m && parts.length < 3) parts.push(`${m}m`);
  return parts.join(' ') || '<1m';
}

function OverviewPanel({ device, facts }: { device: Device; facts: FactsResponse | undefined }) {
  const f = facts?.facts;
  const inventory = f?.inventory ?? [];
  const uptime =
    device.uptimeSeconds != null && device.uptimeCapturedAt
      ? {
          text: humanizeDuration(device.uptimeSeconds),
          capturedAt: new Date(device.uptimeCapturedAt),
          lastBoot: new Date(
            new Date(device.uptimeCapturedAt).getTime() - device.uptimeSeconds * 1000,
          ),
        }
      : null;
  return (
    <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-3 font-medium">Device</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Name" value={device.name} />
          <Field
            label="Host"
            value={
              <span className="font-mono">
                {device.host}
                {device.port ? `:${device.port}` : ''}
              </span>
            }
          />
          <Field label="Model" value={device.modelId} />
          <Field label="Protocol" value={device.protocol} />
          <Field label="Status" value={device.lastStatus} />
          <Field
            label="Last backup"
            value={device.lastBackupAt ? new Date(device.lastBackupAt).toLocaleString() : 'never'}
          />
          {uptime && (
            <>
              <Field label="Uptime" value={uptime.text} />
              <Field label="Last boot" value={uptime.lastBoot.toLocaleString()} />
              <Field label="Uptime captured" value={uptime.capturedAt.toLocaleString()} />
            </>
          )}
        </dl>
      </Card>
      <Card>
        <h2 className="mb-3 font-medium">Hardware</h2>
        {f ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Serial number" value={f.serial} />
            <Field label="Hardware model" value={f.model} />
            <Field label="OS version" value={f.osVersion} />
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            {facts?.hasConfig === false
              ? 'No backup yet — run one to populate hardware details.'
              : 'Hardware details are not available for this model.'}
          </p>
        )}
      </Card>
      {inventory.length > 0 && (
        <Card className="p-0 lg:col-span-2">
          <h2 className="border-b border-border px-4 py-3 font-medium">Hardware inventory</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium">PID</th>
                  <th className="px-4 py-2 font-medium">Serial</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {inventory.map((it, i) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: static inventory rows
                    key={i}
                  >
                    <td className="px-4 py-2" style={{ paddingLeft: `${it.depth * 1.25 + 1}rem` }}>
                      {it.name || '—'}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{it.description ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                      {it.pid ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                      {it.serial ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function DeviceDetailPage() {
  const { deviceId } = useParams({ strict: false }) as { deviceId: string };
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { sha?: string };
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
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
    retry: false, // a 404 (device not in the selected tenant) shouldn't retry
  });

  // Switching tenants can leave this page pointing at a device the new org
  // doesn't have. Rather than spin on "Loading…", go back to the device list.
  useEffect(() => {
    if (device.error instanceof ApiError && device.error.statusCode === 404) {
      navigate({ to: '/devices' });
    }
  }, [device.error, navigate]);
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
  const facts = useQuery({
    queryKey: ['facts', orgId, deviceId],
    queryFn: () => api<FactsResponse>(`${base}/facts`),
    enabled: !!orgId,
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
      qc.invalidateQueries({ queryKey: ['facts', orgId, deviceId] });
    },
  });

  const d = device.data;
  if (!d) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {statusDot(d.lastStatus)}
            <h1 className="truncate text-2xl font-semibold tracking-tight">{d.name}</h1>
          </div>
          <p className="mt-1 break-all font-mono text-sm text-muted-foreground">
            {d.host}
            {d.port ? `:${d.port}` : ''} · {d.modelId} · {d.protocol}
          </p>
          {d.lastError && <p className="mt-1 text-sm text-destructive">{d.lastError}</p>}
        </div>
        {(role === 'admin' || role === 'operator') && (
          <Button
            className="w-full sm:w-auto"
            onClick={() => backup.mutate()}
            disabled={backup.isPending}
          >
            {backup.isPending ? 'Backing up…' : 'Backup now'}
          </Button>
        )}
      </div>
      {backup.data?.error && <ErrorText>{backup.data.error}</ErrorText>}

      <div className="mt-6 flex gap-1 overflow-x-auto border-b border-border">
        {(
          [
            ...(['overview', 'config', 'versions', 'jobs'] as const),
            ...(role === 'admin' ? (['edit'] as const) : []),
          ] as Tab[]
        ).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2 text-sm capitalize',
              tab === t
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewPanel device={d} facts={facts.data} />}

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
          <div className="overflow-x-auto">
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
                    onClick={() =>
                      role !== 'readonly' && setOpenJob(openJob === j.id ? null : j.id)
                    }
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
                    <td className="max-w-md truncate px-4 py-2 text-destructive">
                      {j.error ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
      <MoveDeviceSection device={device} />
    </Card>
  );
}

function MoveDeviceSection({ device }: { device: Device }) {
  const { orgId, orgs } = useOrg();
  const navigate = useNavigate();
  const [toOrgId, setToOrgId] = useState('');
  const [toGroupId, setToGroupId] = useState('');
  const targets = orgs.filter((o) => o.id !== orgId);

  const groups = useQuery({
    queryKey: ['groups', toOrgId],
    queryFn: () => api<{ id: string; name: string }[]>(`/orgs/${toOrgId}/groups`),
    enabled: !!toOrgId,
  });

  const move = useMutation({
    mutationFn: () => post(`/orgs/${orgId}/devices/${device.id}/move`, { toOrgId, toGroupId }),
    onSuccess: () => {
      // the device now lives in another org; leave this (now-cross-org) page
      navigate({ to: '/devices' });
    },
  });

  if (targets.length === 0) return null;

  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="text-sm font-medium">Move to another organization</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The config moves into the target org's git repository; the device's credential is cleared
        (credentials are per-org) and must be reassigned there.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <select
          className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={toOrgId}
          onChange={(e) => {
            setToOrgId(e.target.value);
            setToGroupId('');
          }}
        >
          <option value="">Target org…</option>
          {targets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={toGroupId}
          onChange={(e) => setToGroupId(e.target.value)}
          disabled={!toOrgId}
        >
          <option value="">Target group…</option>
          {groups.data?.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={!toOrgId || !toGroupId || move.isPending}
          onClick={() => move.mutate()}
        >
          Move device
        </Button>
      </div>
      <ErrorText>{move.error?.message}</ErrorText>
    </div>
  );
}
