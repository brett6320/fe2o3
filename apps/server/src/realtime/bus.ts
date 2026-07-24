import { EventEmitter } from 'node:events';

export interface BackupEvent {
  type: 'job.started' | 'job.finished' | 'device.updated';
  orgId: string;
  deviceId: string;
  deviceName?: string;
  jobId?: string;
  status?: string;
  commitSha?: string | null;
}

/** In-process event bus bridging the backup engine to SSE clients and hooks. */
export class EventBus extends EventEmitter {
  publish(event: BackupEvent) {
    this.emit('event', event);
  }

  subscribe(listener: (event: BackupEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}
