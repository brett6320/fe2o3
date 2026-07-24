import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, patch, post } from '@/lib/api';
import { useSession } from '@/lib/session';

interface User {
  id: string;
  email: string;
  displayName: string;
  isSuperadmin: boolean;
  disabled: boolean;
  totpEnabled: boolean;
  createdAt: string;
}

export function UsersPage() {
  const qc = useQueryClient();
  const session = useSession();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('/users') });
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', displayName: '' });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: () => post<User>('/users', form),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setForm({ email: '', password: '', displayName: '' });
    },
  });
  const toggleDisabled = useMutation({
    mutationFn: (u: User) => patch<User>(`/users/${u.id}`, { disabled: !u.disabled }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (u: User) => del<{ ok: boolean }>(`/users/${u.id}`),
    onSuccess: invalidate,
  });

  if (session.data && !session.data.isSuperadmin) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">User management requires superadmin access.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage accounts and access</p>
        </div>
        <Button onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? 'Cancel' : 'Add user'}
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
            <div className="space-y-2">
              <Label htmlFor="new-name">Name</Label>
              <Input
                id="new-name"
                value={form.displayName}
                onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Password</Label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={10}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              />
            </div>
            <ErrorText>{create.error?.message}</ErrorText>
            <Button type="submit" disabled={create.isPending}>
              Create user
            </Button>
          </form>
        </Card>
      )}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">MFA</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {users.data?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2">
                  <div className="font-medium">{u.displayName || u.email}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-2">{u.isSuperadmin ? 'Superadmin' : 'Member'}</td>
                <td className="px-4 py-2">{u.totpEnabled ? 'TOTP' : '—'}</td>
                <td className="px-4 py-2">
                  <span className={u.disabled ? 'text-destructive' : 'text-success'}>
                    {u.disabled ? 'Disabled' : 'Active'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  {u.id !== session.data?.id && (
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => toggleDisabled.mutate(u)}>
                        {u.disabled ? 'Enable' : 'Disable'}
                      </Button>
                      <Button variant="destructive" onClick={() => remove.mutate(u)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
