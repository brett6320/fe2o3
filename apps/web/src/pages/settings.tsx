import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorText, Input, Label } from '@/components/ui';
import { api, patch } from '@/lib/api';
import { useSession } from '@/lib/session';

interface Settings {
  baseUrl?: string;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  concurrency?: number;
}

export function SettingsPage() {
  const session = useSession();
  const qc = useQueryClient();
  const isSuper = session.data?.isSuperadmin ?? false;
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('/settings'),
    enabled: isSuper,
  });
  const [form, setForm] = useState<Settings>({});
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => patch<Settings>('/settings', form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  if (!isSuper) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Settings require superadmin access.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">Instance-wide configuration</p>

      <Card className="mt-6 max-w-md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="s-base">Base URL (used for passkey RP ID)</Label>
            <Input
              id="s-base"
              type="url"
              placeholder="https://fe2o3.example.com"
              value={form.baseUrl ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="s-gan">Git author name</Label>
              <Input
                id="s-gan"
                placeholder="fe2o3"
                value={form.gitAuthorName ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, gitAuthorName: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-gae">Git author email</Label>
              <Input
                id="s-gae"
                type="email"
                placeholder="fe2o3@localhost"
                value={form.gitAuthorEmail ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, gitAuthorEmail: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-conc">Backup concurrency</Label>
            <Input
              id="s-conc"
              type="number"
              min={1}
              max={200}
              value={form.concurrency ?? 20}
              onChange={(e) => setForm((f) => ({ ...f, concurrency: Number(e.target.value) }))}
            />
          </div>
          <ErrorText>{save.error?.message}</ErrorText>
          {save.isSuccess && <p className="text-sm text-success">Saved.</p>}
          <Button type="submit" disabled={save.isPending}>
            Save settings
          </Button>
        </form>
      </Card>
    </div>
  );
}
