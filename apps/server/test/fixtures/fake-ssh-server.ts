import { generateKeyPairSync } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { type Connection, Server } from 'ssh2';

export interface FakeDevice {
  /** Prompt shown after login and after each command, e.g. `router1#`. */
  prompt: string;
  /** Map of exact command → response body (string) or paged body (string[]). */
  responses: Record<string, string | string[]>;
  username: string;
  password: string;
  /** Login banner pages shown before the first prompt, separated by --More--. */
  bannerPages?: string[];
}

const hostKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

/** Minimal SSH device emulator: password auth, shell channel, prompt-driven, --More-- pagination. */
export async function startFakeDevice(device: FakeDevice) {
  const server = new Server({ hostKeys: [hostKey] }, (client: Connection) => {
    client.on('authentication', (ctx) => {
      if (
        (ctx.method === 'password' &&
          ctx.username === device.username &&
          ctx.password === device.password) ||
        (ctx.method === 'keyboard-interactive' && ctx.username === device.username)
      ) {
        if (ctx.method === 'keyboard-interactive') {
          ctx.prompt([{ prompt: 'Password:', echo: false }], (answers) => {
            if (answers[0] === device.password) ctx.accept();
            else ctx.reject();
          });
          return;
        }
        ctx.accept();
      } else if (ctx.method === 'none') {
        ctx.reject(['password', 'keyboard-interactive']);
      } else {
        ctx.reject();
      }
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (accept) => accept?.());
        session.on('shell', (accept) => {
          const stream = accept();
          let lineBuf = '';
          // pages still waiting for a keypress; drained one per received byte
          let pendingPages: string[] = [];

          const writePage = () => {
            const page = pendingPages.shift();
            if (page !== undefined) stream.write(page.replace(/\n/g, '\r\n'));
            if (pendingPages.length > 0) {
              stream.write('\r\n --More-- ');
            } else {
              stream.write(`\r\n${device.prompt} `);
            }
          };

          if (device.bannerPages && device.bannerPages.length > 0) {
            pendingPages = [...device.bannerPages];
            stream.write('Welcome to fake device\r\n');
            writePage();
          } else {
            stream.write(`Welcome to fake device\r\n${device.prompt} `);
          }

          stream.on('data', (data: Buffer) => {
            if (pendingPages.length > 0) {
              // any keypress (fe2o3 sends space) advances pagination
              writePage();
              return;
            }
            lineBuf += data.toString('utf8');
            let idx = lineBuf.indexOf('\n');
            while (idx >= 0) {
              const line = lineBuf.slice(0, idx).replace(/\r$/, '');
              lineBuf = lineBuf.slice(idx + 1);
              const cmd = line.trim();
              stream.write(`${line}\r\n`);
              if (cmd.length > 0) {
                const body = device.responses[cmd];
                if (Array.isArray(body)) {
                  pendingPages = [...body];
                  writePage();
                  idx = lineBuf.indexOf('\n');
                  continue;
                }
                if (body !== undefined) {
                  if (body.length > 0) stream.write(`${body.replace(/\n/g, '\r\n')}\r\n`);
                } else if (cmd === 'exit' || cmd === 'logout') {
                  stream.end();
                  return;
                } else {
                  stream.write(`% Invalid input detected at '^' marker.\r\n`);
                }
              }
              stream.write(`${device.prompt} `);
              idx = lineBuf.indexOf('\n');
            }
          });
        });
      });
    });
    client.on('error', () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
