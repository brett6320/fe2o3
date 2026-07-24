/** Prompt-driven CLI session over SSH or telnet. */
export interface Transport {
  /** Wait until output matches `pattern`; returns everything received since the last call. */
  expect(pattern: RegExp, timeoutMs?: number): Promise<string>;
  /** Send a line (newline appended). */
  send(line: string): Promise<void>;
  /** Send raw bytes without a newline (e.g. space to continue pagination). */
  sendRaw(data: string): Promise<void>;
  /** Complete raw transcript of the session (for job logs). */
  transcript(): string;
  close(): Promise<void>;
}

export interface ConnectOptions {
  host: string;
  port: number;
  username: string;
  password?: string | undefined;
  privateKey?: string | undefined;
  passphrase?: string | undefined;
  timeoutMs?: number;
  /** Extra ssh algorithm names for legacy gear (kex, ciphers, serverHostKey). */
  legacyAlgorithms?: boolean;
}

export class ExpectTimeoutError extends Error {
  constructor(pattern: RegExp, buffered: string) {
    super(`timed out waiting for ${pattern}; last output: ${JSON.stringify(buffered.slice(-200))}`);
  }
}
