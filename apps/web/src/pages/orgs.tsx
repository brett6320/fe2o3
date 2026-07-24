import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, post, put } from '@/lib/api';
import { useInvalidateSession, useSession } from '@/lib/session';

interface Org {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}
interface Member {
  id: string;
  userId: string;
  role: 'admin' | 'operator' | 'readonly';
  email: string;
  displayName: string;
}
interface User {
  id: string;
  email: string;
  displayName: string;
}

const ROLES = ['admin', 'operator', 'readonly'] as const;
const selectCls = 'flex h-9 rounded-md border border-input bg-transparent px-2 text-sm';

function MembersPanel({ org, users }: { org: Org; users: User[] }) {
  const qc = useQueryClient();
  const invalidateSession = useInvalidateSession();
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<(typeof ROLES)[number]>('readonly');

  const members = useQuery({
    queryKey: ['org-members', org.id],
    queryFn: () => api<Member[]>(`/orgs/${org.id}/members`),
  });
  const refresh = async () => {
    qc.invalidateQueries({ queryKey: ['org-members', org.id] });
    await invalidateSession(); // membership changes can affect the org switcher
  };

  const upsert = useMutation({
    mutationFn: (m: { userId: string; role: string }) => put(`/orgs/${org.id}/members`, m),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => del(`/orgs/${org.id}/members/${userId}`),
    onSuccess: refresh,
  });

  const memberIds = new Set(members.data?.map((m) => m.userId));
  const addable = users.filter((u) => !memberIds.has(u.id));

  return (
    <div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-border/50">
          {members.data?.map((m) => (
            <tr key={m.id}>
              <td className="py-1.5 pr-4">
                {m.displayName || m.email}
                <span className="ml-2 text-xs text-muted-foreground">{m.email}</span>
              </td>
              <td className="py-1.5 pr-4">
                <select
                  className={selectCls}
                  value={m.role}
                  onChange={(e) => upsert.mutate({ userId: m.userId, role: e.target.value })}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1.5 text-right">
                <Button variant="ghost" onClick={() => remove.mutate(m.userId)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
          {members.data?.length === 0 && (
            <tr>
              <td className="py-3 text-muted-foreground">No members yet</td>
            </tr>
          )}
        </tbody>
      </table>

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (addUserId) upsert.mutate({ userId: addUserId, role: addRole });
          setAddUserId('');
        }}
      >
        <select
          className={`${selectCls} flex-1`}
          value={addUserId}
          onChange={(e) => setAddUserId(e.target.value)}
        >
          <option value="">Add a user…</option>
          {addable.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName ? `${u.displayName} (${u.email})` : u.email}
            </option>
          ))}
        </select>
        <select
          className={selectCls}
          value={addRole}
          onChange={(e) => setAddRole(e.target.value as (typeof ROLES)[number])}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <Button type="submit" disabled={!addUserId || upsert.isPending}>
          Add
        </Button>
      </form>
      <ErrorText>{upsert.error?.message ?? remove.error?.message}</ErrorText>
    </div>
  );
}

interface MirrorConfig {
  mirrorUrl: string | null;
  mirrorBranch: string;
  hasToken: boolean;
  hasSshKey: boolean;
}

function MirrorPanel({ org }: { org: Org }) {
  const qc = useQueryClient();
  const cfg = useQuery({
    queryKey: ['mirror', org.id],
    queryFn: () => api<MirrorConfig>(`/orgs/${org.id}/mirror`),
  });
  const [form, setForm] = useState({ url: '', branch: 'main', token: '', sshKey: '' });
  const [testResult, setTestResult] = useState<string | null>(null);
  const loaded = cfg.data;
  // seed the form from the saved config once it loads
  useEffect(() => {
    if (loaded) {
      setForm({ url: loaded.mirrorUrl ?? '', branch: loaded.mirrorBranch, token: '', sshKey: '' });
    }
  }, [loaded]);

  const save = useMutation({
    mutationFn: () =>
      put<MirrorConfig>(`/orgs/${org.id}/mirror`, {
        mirrorUrl: form.url || null,
        mirrorBranch: form.branch || 'main',
        ...(form.token ? { token: form.token } : {}),
        ...(form.sshKey ? { sshKey: form.sshKey } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mirror', org.id] });
      setForm((f) => ({ ...f, token: '', sshKey: '' }));
    },
  });
  const test = useMutation({
    mutationFn: () => post<{ ok: boolean; error?: string }>(`/orgs/${org.id}/mirror/test`),
    onSuccess: (r) => setTestResult(r.ok ? 'Push succeeded.' : `Failed: ${r.error}`),
  });

  const isSsh = form.url.startsWith('git@') || form.url.startsWith('ssh://');

  return (
    <div className="mt-2 space-y-3 rounded-md border border-border p-3">
      <div className="text-sm font-medium">External git mirror</div>
      <p className="text-xs text-muted-foreground">
        Force-pushed to after each changed backup, keeping an external copy in sync.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-[1fr_140px] gap-2">
          <div className="space-y-1">
            <Label htmlFor={`m-url-${org.id}`}>Remote URL</Label>
            <Input
              id={`m-url-${org.id}`}
              placeholder="git@github.com:org/configs.git or https://github.com/org/configs.git"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`m-branch-${org.id}`}>Branch</Label>
            <Input
              id={`m-branch-${org.id}`}
              value={form.branch}
              onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
            />
          </div>
        </div>
        {isSsh ? (
          <div className="space-y-1">
            <Label htmlFor={`m-key-${org.id}`}>
              SSH deploy key {loaded?.hasSshKey && '(set — leave blank to keep)'}
            </Label>
            <textarea
              id={`m-key-${org.id}`}
              rows={4}
              spellCheck={false}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              placeholder={loaded?.hasSshKey ? '••••••••' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
              value={form.sshKey}
              onChange={(e) => setForm((f) => ({ ...f, sshKey: e.target.value }))}
            />
          </div>
        ) : (
          <div className="space-y-1">
            <Label htmlFor={`m-token-${org.id}`}>
              Access token {loaded?.hasToken && '(set — leave blank to keep)'}
            </Label>
            <Input
              id={`m-token-${org.id}`}
              type="password"
              placeholder={loaded?.hasToken ? '••••••••' : 'ghp_…'}
              value={form.token}
              onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))}
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={save.isPending}>
            Save mirror
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => test.mutate()}
            disabled={test.isPending || !loaded?.mirrorUrl}
          >
            Test push
          </Button>
          {testResult && <span className="text-xs text-muted-foreground">{testResult}</span>}
        </div>
        <ErrorText>{save.error?.message}</ErrorText>
      </form>
    </div>
  );
}

export function OrgsPage() {
  const session = useSession();
  const qc = useQueryClient();
  const invalidateSession = useInvalidateSession();
  const isSuper = session.data?.isSuperadmin ?? false;
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', slug: '' });

  const orgs = useQuery({
    queryKey: ['orgs'],
    queryFn: () => api<Org[]>('/orgs'),
    enabled: isSuper,
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<User[]>('/users'),
    enabled: isSuper,
  });

  const create = useMutation({
    mutationFn: () => post<Org>('/orgs', form),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
      await invalidateSession();
      setShowCreate(false);
      setForm({ name: '', slug: '' });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/orgs/${id}`),
    onSuccess: async () => {
      qc.invalidateQueries({ queryKey: ['orgs'] });
      await invalidateSession();
    },
  });

  if (session.data && !isSuper) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Organization management requires superadmin access.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tenants — each has its own devices, credentials, and git repository
          </p>
        </div>
        <Button onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Cancel' : 'Add organization'}
        </Button>
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
                <Label htmlFor="o-name">Name</Label>
                <Input
                  id="o-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="o-slug">Slug (git repo name)</Label>
                <Input
                  id="o-slug"
                  required
                  pattern="[a-z0-9][a-z0-9-]*"
                  placeholder="acme"
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                />
              </div>
            </div>
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending}>
              Create organization
            </Button>
          </form>
        </Card>
      )}

      <div className="mt-6 space-y-3">
        {orgs.data?.map((org) => (
          <Card key={org.id} className="overflow-hidden p-0">
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={() => setExpanded(expanded === org.id ? null : org.id)}
                className="flex items-center gap-2 text-left"
              >
                {expanded === org.id ? (
                  <ChevronDown className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-4 text-muted-foreground" />
                )}
                <span className="font-medium">{org.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{org.slug}</code>
              </button>
              <span className="ml-auto text-xs text-muted-foreground">
                created {new Date(org.createdAt).toLocaleDateString()}
              </span>
              <Button
                variant="destructive"
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete organization "${org.name}"? Its devices, credentials, and job history will be removed. The git repository on disk is kept.`,
                    )
                  ) {
                    remove.mutate(org.id);
                  }
                }}
              >
                Delete
              </Button>
            </div>
            {expanded === org.id && (
              <div className="border-t border-border bg-muted/20 px-4 py-3">
                <MembersPanel org={org} users={users.data ?? []} />
                <MirrorPanel org={org} />
              </div>
            )}
          </Card>
        ))}
        {orgs.data?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No organizations</p>
        )}
      </div>
      <ErrorText>{remove.error?.message}</ErrorText>
    </div>
  );
}
