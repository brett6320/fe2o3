import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { post } from '@/lib/api';
import { type SessionUser, useInvalidateSession } from '@/lib/session';

export function LoginPage() {
  const navigate = useNavigate();
  const invalidate = useInvalidateSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const login = useMutation({
    mutationFn: () => post<SessionUser>('/auth/login', { email, password }),
    onSuccess: async () => {
      await invalidate();
      navigate({ to: '/' });
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary font-mono font-bold text-primary-foreground">
            Fe
          </div>
          <div>
            <h1 className="font-semibold">fe2o3</h1>
            <p className="text-xs text-muted-foreground">Config backup for network devices</p>
          </div>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <ErrorText>{login.error?.message}</ErrorText>
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
