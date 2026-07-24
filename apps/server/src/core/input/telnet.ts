import { Socket } from 'node:net';
import { type ConnectOptions, ExpectTimeoutError, type Transport } from './transport.js';

const IAC = 255;
const DONT = 254;
const DO = 253;
const WONT = 252;
const WILL = 251;

const DEFAULT_TIMEOUT = 20_000;

/**
 * Minimal telnet client: refuses every option negotiation (WILL→DONT, DO→WONT),
 * which is enough for network gear CLIs.
 */
export async function connectTelnet(opts: ConnectOptions): Promise<Transport> {
  const socket = new Socket();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  let buffer = '';
  let full = '';
  let closed = false;
  const waiters: Array<() => void> = [];

  socket.on('data', (chunk: Buffer) => {
    const clean: number[] = [];
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i];
      if (byte === IAC && i + 1 < chunk.length) {
        const cmd = chunk[i + 1];
        if (cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) {
          const opt = chunk[i + 2];
          if (opt !== undefined && cmd !== undefined) {
            const respond = cmd === WILL || cmd === WONT ? DONT : WONT;
            socket.write(Buffer.from([IAC, respond, opt]));
          }
          i += 2;
          continue;
        }
        if (cmd === IAC) {
          clean.push(IAC);
          i += 1;
          continue;
        }
        i += 1;
        continue;
      }
      if (byte !== undefined) clean.push(byte);
    }
    const text = Buffer.from(clean).toString('utf8');
    buffer += text;
    full += text;
    for (const w of waiters.splice(0)) w();
  });
  socket.on('close', () => {
    closed = true;
    for (const w of waiters.splice(0)) w();
  });
  socket.on('error', () => {
    closed = true;
    for (const w of waiters.splice(0)) w();
  });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('telnet connect timeout')), timeoutMs);
    socket.connect(opts.port, opts.host, () => {
      clearTimeout(t);
      resolve();
    });
    socket.once('error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });

  return {
    async expect(pattern: RegExp, expectTimeoutMs = timeoutMs) {
      // Idle timeout — resets whenever new data arrives (see ssh.ts).
      let seen = buffer.length;
      let deadline = Date.now() + expectTimeoutMs;
      while (true) {
        if (pattern.test(buffer)) {
          const out = buffer;
          buffer = '';
          return out;
        }
        if (closed) throw new Error(`connection closed while waiting for ${pattern}`);
        if (buffer.length !== seen) {
          seen = buffer.length;
          deadline = Date.now() + expectTimeoutMs;
        }
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
      socket.write(`${line}\r\n`);
    },
    async sendRaw(data: string) {
      socket.write(data);
    },
    transcript() {
      return full;
    },
    async close() {
      socket.destroy();
    },
  };
}
