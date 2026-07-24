import { startAuthentication } from '@simplewebauthn/browser';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, post } from '@/lib/api';
import { type SessionUser, useInvalidateSession } from '@/lib/session';

export function LoginPage() {
  const navigate = useNavigate();
  const invalidate = useInvalidateSession();
  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api<{ needsSetup: boolean }>('/setup/status'),
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [code, setCode] = useState('');

  const finish = async () => {
    await invalidate();
    navigate({ to: '/' });
  };

  const login = useMutation({
    mutationFn: () => post<SessionUser>('/auth/login', { email, password }),
    onSuccess: async (user) => {
      if (user.mfaPending) setMfaStep(true);
      else await finish();
    },
  });

  const verifyTotp = useMutation({
    mutationFn: () => post<{ ok: boolean }>('/auth/mfa/totp', { code }),
    onSuccess: finish,
  });

  const passkey = useMutation({
    mutationFn: async () => {
      const options =
        await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>(
          '/auth/webauthn/options',
        );
      const response = await startAuthentication({ optionsJSON: options });
      return post<{ ok: boolean }>('/auth/webauthn/verify', { response });
    },
    onSuccess: finish,
  });

  if (status.data?.needsSetup) return <Navigate to="/setup" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary font-mono font-bold text-primary-foreground">
            Fe
          </div>
          <div>
            <h1 className="font-semibold">Fe2O3</h1>
            <p className="text-xs text-muted-foreground">Config backup for network devices</p>
          </div>
        </div>

        {mfaStep ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              verifyTotp.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="code">Authenticator code</Label>
              <Input
                id="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <ErrorText>{verifyTotp.error?.message}</ErrorText>
            <Button type="submit" className="w-full" disabled={verifyTotp.isPending}>
              Verify
            </Button>
          </form>
        ) : (
          <>
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
                  autoComplete="username webauthn"
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
            <div className="mt-4 border-t border-border pt-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => passkey.mutate()}
                disabled={passkey.isPending}
              >
                <KeyRound className="size-4" />
                Sign in with passkey
              </Button>
              <ErrorText>{passkey.error?.message}</ErrorText>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
