import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, patch, post } from '@/lib/api';
import { useOrg } from '@/lib/org-context';
import type { Device } from './devices';

const STATUS_DOT: Record<Device['lastStatus'], string> = {
  never: 'bg-muted-foreground',
  running: 'bg-blue-500',
  success: 'bg-green-500',
  failed: 'bg-red-500',
};

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

function MoveGroupSection({ group, onMoved }: { group: Group; onMoved: () => void }) {
  const { orgId, orgs } = useOrg();
  const qc = useQueryClient();
  const [toOrgId, setToOrgId] = useState('');
  const targets = orgs.filter((o) => o.id !== orgId);

  const move = useMutation({
    mutationFn: () =>
      post<{ movedDevices: number }>(`/orgs/${orgId}/groups/${group.id}/move`, { toOrgId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups', orgId] });
      qc.invalidateQueries({ queryKey: ['devices', orgId] });
      onMoved();
    },
  });

  if (targets.length === 0) return null;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <h3 className="text-sm font-medium">Move to another organization</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Moves the group and all its devices (config files included) into the target org. Device and
        group credentials are cleared and must be reassigned there.
      </p>
      <div className="mt-3 flex items-end gap-2">
        <select
          className="flex h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={toOrgId}
          onChange={(e) => setToOrgId(e.target.value)}
        >
          <option value="">Target org…</option>
          {targets.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          disabled={!toOrgId || move.isPending}
          onClick={() => move.mutate()}
        >
          Move group
        </Button>
      </div>
      <ErrorText>{move.error?.message}</ErrorText>
    </div>
  );
}

export function GroupsPage() {
  const { orgId, role } = useOrg();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', pathSlug: '', defaultCredentialId: '' });
  const [editing, setEditing] = useState<Group | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    pathSlug: '',
    defaultCredentialId: '',
    defaultIntervalSec: '3600',
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const groups = useQuery({
    queryKey: ['groups', orgId],
    queryFn: () => api<Group[]>(`/orgs/${orgId}/groups`),
    enabled: !!orgId,
  });
  const devices = useQuery({
    queryKey: ['devices', orgId],
    queryFn: () => api<Device[]>(`/orgs/${orgId}/devices`),
    enabled: !!orgId,
  });
  const devicesByGroup = (id: string) => devices.data?.filter((d) => d.groupId === id) ?? [];
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
  const update = useMutation({
    mutationFn: () =>
      patch<Group>(`/orgs/${orgId}/groups/${editing?.id}`, {
        name: editForm.name,
        pathSlug: editForm.pathSlug,
        defaultCredentialId: editForm.defaultCredentialId || null,
        defaultIntervalSec: Number(editForm.defaultIntervalSec),
      }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const startEdit = (g: Group) => {
    setEditing(g);
    setEditForm({
      name: g.name,
      pathSlug: g.pathSlug,
      defaultCredentialId: g.defaultCredentialId ?? '',
      defaultIntervalSec: String(g.defaultIntervalSec),
    });
  };

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

      {editing && (
        <Card className="mt-4 max-w-md">
          <h2 className="mb-4 font-medium">Edit group: {editing.name}</h2>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ge-name">Name</Label>
                <Input
                  id="ge-name"
                  required
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ge-slug">Path slug</Label>
                <Input
                  id="ge-slug"
                  required
                  pattern="[a-z0-9][a-z0-9-]*"
                  value={editForm.pathSlug}
                  onChange={(e) => setEditForm((f) => ({ ...f, pathSlug: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ge-cred">Default credential</Label>
                <select
                  id="ge-cred"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                  value={editForm.defaultCredentialId}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, defaultCredentialId: e.target.value }))
                  }
                >
                  <option value="">None</option>
                  {creds.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ge-interval">Default interval (seconds)</Label>
                <Input
                  id="ge-interval"
                  type="number"
                  min={60}
                  required
                  value={editForm.defaultIntervalSec}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, defaultIntervalSec: e.target.value }))
                  }
                />
              </div>
            </div>
            {editForm.pathSlug !== editing.pathSlug && (
              <p className="text-xs text-warning">
                Changing the path slug moves every device file in the git repository (history is
                preserved).
              </p>
            )}
            <ErrorText>{update.error?.message}</ErrorText>
            <div className="flex gap-2">
              <Button type="submit" disabled={update.isPending}>
                Save
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
          </form>
          <MoveGroupSection group={editing} onMoved={() => setEditing(null)} />
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
            {groups.data?.map((g) => {
              const isOpen = expanded.has(g.id);
              const groupDevices = devicesByGroup(g.id);
              const count = g.deviceCount ?? groupDevices.length;
              return (
                <Fragment key={g.id}>
                  <tr>
                    <td className="px-4 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleExpand(g.id)}
                        className="flex items-center gap-2 hover:text-foreground"
                        aria-expanded={isOpen}
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        {g.name}
                      </button>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{g.pathSlug}/</td>
                    <td className="px-4 py-2">{count}</td>
                    <td className="px-4 py-2">{Math.round(g.defaultIntervalSec / 60)} min</td>
                    <td className="px-4 py-2 text-right">
                      {role === 'admin' && (
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" onClick={() => startEdit(g)}>
                            Edit
                          </Button>
                          <Button variant="destructive" onClick={() => remove.mutate(g.id)}>
                            Delete
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td colSpan={5} className="px-4 py-2">
                        {groupDevices.length === 0 ? (
                          <p className="py-2 pl-6 text-sm text-muted-foreground">
                            No devices in this group
                          </p>
                        ) : (
                          <ul className="space-y-1 pl-6">
                            {groupDevices.map((d) => (
                              <li key={d.id} className="flex items-center gap-3 text-sm">
                                <span
                                  className={`size-2 shrink-0 rounded-full ${STATUS_DOT[d.lastStatus]}`}
                                  title={d.lastStatus}
                                />
                                <Link
                                  to="/devices/$deviceId"
                                  params={{ deviceId: d.id }}
                                  className="font-medium text-primary hover:underline"
                                >
                                  {d.name}
                                </Link>
                                <span className="font-mono text-xs text-muted-foreground">
                                  {d.host}
                                </span>
                                <span className="text-xs text-muted-foreground">{d.modelId}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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
