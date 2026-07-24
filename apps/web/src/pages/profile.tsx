import { startRegistration } from '@simplewebauthn/browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, del, post } from '@/lib/api';
import { useInvalidateSession, useSession } from '@/lib/session';

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
}

function PasswordCard() {
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
    <Card className="max-w-md">
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
  );
}

function TotpCard() {
  const session = useSession();
  const invalidate = useInvalidateSession();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const enabled = session.data?.totpEnabled ?? false;

  const enroll = useMutation({
    mutationFn: () => post<{ otpauthUrl: string; qrDataUrl: string }>('/profile/totp/enroll'),
    onSuccess: (data) => setQr(data.qrDataUrl),
  });
  const confirm = useMutation({
    mutationFn: () => post<{ ok: boolean }>('/profile/totp/confirm', { code }),
    onSuccess: async () => {
      setQr(null);
      setCode('');
      await invalidate();
    },
  });
  const disable = useMutation({
    mutationFn: () => post<{ ok: boolean }>('/profile/totp/disable', { code }),
    onSuccess: async () => {
      setCode('');
      await invalidate();
    },
  });

  return (
    <Card className="max-w-md">
      <h2 className="font-medium">Authenticator app (TOTP)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {enabled
          ? 'Enabled — codes required at sign-in.'
          : 'Add a second factor using any authenticator app.'}
      </p>
      {!enabled && !qr && (
        <Button className="mt-4" onClick={() => enroll.mutate()} disabled={enroll.isPending}>
          Set up TOTP
        </Button>
      )}
      {qr && (
        <div className="mt-4 space-y-4">
          <img src={qr} alt="TOTP enrollment QR code" className="size-44 rounded-md bg-white p-2" />
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              confirm.mutate();
            }}
          >
            <Input
              placeholder="123456"
              inputMode="numeric"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button type="submit" disabled={confirm.isPending}>
              Confirm
            </Button>
          </form>
          <ErrorText>{confirm.error?.message}</ErrorText>
        </div>
      )}
      {enabled && (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            disable.mutate();
          }}
        >
          <Input
            placeholder="Code to disable"
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" variant="destructive" disabled={disable.isPending}>
            Disable
          </Button>
          <ErrorText>{disable.error?.message}</ErrorText>
        </form>
      )}
    </Card>
  );
}

function PasskeysCard() {
  const qc = useQueryClient();
  const passkeys = useQuery({
    queryKey: ['passkeys'],
    queryFn: () => api<Passkey[]>('/profile/passkeys'),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['passkeys'] });

  const register = useMutation({
    mutationFn: async () => {
      const options = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>(
        '/profile/passkeys/options',
      );
      const response = await startRegistration({ optionsJSON: options });
      return post<{ ok: boolean }>('/profile/passkeys/verify', {
        name: `Passkey (${new Date().toLocaleDateString()})`,
        response,
      });
    },
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/profile/passkeys/${id}`),
    onSuccess: invalidate,
  });

  return (
    <Card className="max-w-md">
      <h2 className="font-medium">Passkeys</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in without a password using Touch ID, security keys, or your phone.
      </p>
      <ul className="mt-4 space-y-2">
        {passkeys.data?.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
          >
            <span>
              {p.name}
              <span className="ml-2 text-xs text-muted-foreground">
                added {new Date(p.createdAt).toLocaleDateString()}
              </span>
            </span>
            <Button variant="ghost" onClick={() => remove.mutate(p.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button className="mt-4" onClick={() => register.mutate()} disabled={register.isPending}>
        Add passkey
      </Button>
      <ErrorText>{register.error?.message}</ErrorText>
    </Card>
  );
}

export function ProfilePage() {
  const session = useSession();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">{session.data?.email}</p>
      <div className="mt-6 space-y-4">
        <PasswordCard />
        <TotpCard />
        <PasskeysCard />
      </div>
    </div>
  );
}
