/**
 * A fully-prepared, serializable unit of collection work handed to a collector.
 * Everything a worker needs to run one backup session — no DB, keyring, or git
 * access required inside the collector. Secrets are already decrypted (plaintext)
 * because they cross an in-process thread boundary, never a wire.
 */
export interface CollectTask {
  jobId: string;
  deviceId: string;
  deviceName: string;
  /** Driver model id; the collector re-resolves the spec from its own registry. */
  driverId: string;
  protocol: 'ssh' | 'telnet';
  connect: {
    host: string;
    port: number;
    /** Final username (login suffix already applied). */
    username: string;
    password?: string | undefined;
    privateKey?: string | undefined;
    passphrase?: string | undefined;
  };
  enablePassword?: string | undefined;
}

/** Result of running a CollectTask. `ok:false` is a normal backup failure. */
export interface CollectResult {
  ok: boolean;
  configText?: string;
  transcript?: string;
  error?: string;
}

/**
 * A collector runs one CollectTask at a time. `run` resolves with a
 * CollectResult for normal outcomes (including backup failures, `ok:false`);
 * it only *rejects* when the collector itself is broken (e.g. its worker
 * thread died), which signals the pool to discard and respawn it.
 */
export interface Collector {
  run(task: CollectTask): Promise<CollectResult>;
  close(): Promise<void>;
}

/** Runs a task somewhere (a pool, a single collector, inline) — the seam the
 * backup orchestration is generic over. */
export type TaskRunner = (task: CollectTask) => Promise<CollectResult>;
