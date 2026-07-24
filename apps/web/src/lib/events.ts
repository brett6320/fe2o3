import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOrg } from './org-context';

export interface BackupEvent {
  type: 'job.started' | 'job.finished' | 'device.updated';
  orgId: string;
  deviceId: string;
  deviceName?: string;
  jobId?: string;
  status?: string;
  commitSha?: string | null;
}

/** Subscribe to org SSE stream and invalidate affected queries. */
export function useOrgEvents(onEvent?: (e: BackupEvent) => void) {
  const { orgId } = useOrg();
  const qc = useQueryClient();

  useEffect(() => {
    if (!orgId) return;
    const source = new EventSource(`/api/v1/orgs/${orgId}/events`);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as BackupEvent;
      qc.invalidateQueries({ queryKey: ['devices', orgId] });
      qc.invalidateQueries({ queryKey: ['device', orgId, event.deviceId] });
      qc.invalidateQueries({ queryKey: ['org-jobs', orgId] });
      qc.invalidateQueries({ queryKey: ['stats', orgId] });
      if (event.type === 'job.finished') {
        qc.invalidateQueries({ queryKey: ['versions', orgId, event.deviceId] });
        qc.invalidateQueries({ queryKey: ['jobs', orgId, event.deviceId] });
      }
      onEvent?.(event);
    };
    return () => source.close();
  }, [orgId, qc, onEvent]);
}
