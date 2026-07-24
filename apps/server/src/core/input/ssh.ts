import { Client, type ConnectConfig } from 'ssh2';
import { type ConnectOptions, ExpectTimeoutError, type Transport } from './transport.js';

const DEFAULT_TIMEOUT = 20_000;

/** Algorithms old network gear still requires; appended, not replacing defaults. */
const LEGACY: ConnectConfig['algorithms'] = {
  kex: [
    'ecdh-sha2-nistp256',
    'ecdh-sha2-nistp384',
    'ecdh-sha2-nistp521',
    'diffie-hellman-group-exchange-sha256',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group1-sha1',
  ],
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'rsa-sha2-512',
    'rsa-sha2-256',
    'ssh-rsa',
    'ssh-dss',
  ],
  cipher: [
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr',
    'aes128-cbc',
    '3des-cbc',
  ],
};

export async function connectSsh(opts: ConnectOptions): Promise<Transport> {
  const client = new Client();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  const stream = await new Promise<import('ssh2').ClientChannel>((resolve, reject) => {
    client
      .on('ready', () => {
        client.shell({ term: 'vt100', cols: 200, rows: 24 }, (err, stream) =>
          err ? reject(err) : resolve(stream),
        );
      })
      .on('error', reject)
      .connect(<ConnectConfig>{
        host: opts.host,
        port: opts.port,
        username: opts.username,
        ...(opts.password !== undefined ? { password: opts.password } : {}),
        ...(opts.privateKey !== undefined ? { privateKey: opts.privateKey } : {}),
        ...(opts.passphrase !== undefined ? { passphrase: opts.passphrase } : {}),
        readyTimeout: timeoutMs,
        ...(opts.legacyAlgorithms !== false ? { algorithms: LEGACY } : {}),
        // Old gear frequently needs keyboard-interactive fallback
        tryKeyboard: true,
      });
    client.on('keyboard-interactive', (_name, _instr, _lang, _prompts, finish) => {
      finish(opts.password !== undefined ? [opts.password] : []);
    });
  });

  let buffer = '';
  let full = '';
  let closed = false;
  const waiters: Array<() => void> = [];

  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    buffer += text;
    full += text;
    for (const w of waiters.splice(0)) w();
  });
  stream.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    buffer += text;
    full += text;
    for (const w of waiters.splice(0)) w();
  });
  stream.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w();
  });

  return {
    async expect(pattern: RegExp, expectTimeoutMs = timeoutMs) {
      const deadline = Date.now() + expectTimeoutMs;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (pattern.test(buffer)) {
          const out = buffer;
          buffer = '';
          return out;
        }
        if (closed) throw new Error(`connection closed while waiting for ${pattern}`);
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ExpectTimeoutError(pattern, buffer);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, Math.min(remaining, 250));
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
    },
    async send(line: string) {
      stream.write(`${line}\n`);
    },
    async sendRaw(data: string) {
      stream.write(data);
    },
    transcript() {
      return full;
    },
    async close() {
      try {
        stream.end();
        client.end();
      } catch {
        // already closed
      }
    },
  };
}
