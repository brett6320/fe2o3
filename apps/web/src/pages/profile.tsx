import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { post } from '@/lib/api';
import { useSession } from '@/lib/session';

export function ProfilePage() {
  const session = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');

  const change = useMutation({
    mutationFn: () =>
      post<{ ok: boolean }>('/profile/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">{session.data?.email}</p>

      <Card className="mt-6 max-w-md">
        <h2 className="mb-4 font-medium">Change password</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            change.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="current">Current password</Label>
            <Input
              id="current"
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="next">New password (min 10 characters)</Label>
            <Input
              id="next"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <ErrorText>{change.error?.message}</ErrorText>
          {change.isSuccess && <p className="text-sm text-success">Password updated.</p>}
          <Button type="submit" disabled={change.isPending}>
            Update password
          </Button>
        </form>
      </Card>

      <Card className="mt-4 max-w-md">
        <h2 className="font-medium">Multi-factor authentication</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          TOTP and passkey enrollment arrive in an upcoming milestone.
        </p>
      </Card>
    </div>
  );
}
