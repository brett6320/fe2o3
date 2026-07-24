import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, post } from '@/lib/api';
import { type SessionUser, useInvalidateSession } from '@/lib/session';

export function SetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const invalidate = useInvalidateSession();
  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api<{ needsSetup: boolean }>('/setup/status'),
  });
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    orgName: '',
    orgSlug: '',
  });

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const setup = useMutation({
    mutationFn: () => post<SessionUser>('/setup', form),
    onSuccess: async () => {
      qc.setQueryData(['setup-status'], { needsSetup: false });
      await invalidate();
      navigate({ to: '/' });
    },
  });

  // Setup is one-shot: once an account exists the wizard is gone for good
  // (the server also rejects further POST /setup with 409).
  if (status.data && !status.data.needsSetup && !setup.isSuccess && !setup.isPending) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <h1 className="text-lg font-semibold">Welcome to Fe2O3</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          Create the first administrator account and your organization.
        </p>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setup.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="displayName">Your name</Label>
            <Input id="displayName" value={form.displayName} onChange={set('displayName')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={form.email} onChange={set('email')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password (min 10 characters)</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={10}
              value={form.password}
              onChange={set('password')}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization</Label>
              <Input id="orgName" required value={form.orgName} onChange={set('orgName')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgSlug">Slug</Label>
              <Input
                id="orgSlug"
                required
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder="acme"
                value={form.orgSlug}
                onChange={set('orgSlug')}
              />
            </div>
          </div>
          <ErrorText>{setup.error?.message}</ErrorText>
          <Button type="submit" className="w-full" disabled={setup.isPending}>
            {setup.isPending ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
