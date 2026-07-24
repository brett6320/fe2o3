import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorText } from '@/components/ui';
import { api, post } from '@/lib/api';
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

type Tab = 'config' | 'versions' | 'jobs';

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
  const [tab, setTab] = useState<Tab>('config');
  const [selectedSha, setSelectedSha] = useState<string | null>(null);
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
        {(['config', 'versions', 'jobs'] as const).map((t) => (
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
