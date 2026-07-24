import type { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:net';

export interface FakeTelnetDevice {
  prompt: string;
  username: string;
  password: string;
  responses: Record<string, string>;
  /** Don't reprint the prompt after a command (Digi Sarian ends on `OK`). */
  suppressCommandPrompt?: boolean;
}

/** Line-based telnet device emulator with login/password prompts. */
export async function startFakeTelnetDevice(device: FakeTelnetDevice) {
  const server: Server = createServer((socket) => {
    let state: 'user' | 'pass' | 'shell' = 'user';
    let buf = '';
    socket.write('login: ');
    socket.on('data', (data) => {
      buf += data.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      let idx = buf.indexOf('\n');
      while (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (state === 'user') {
          state = 'pass';
          socket.write('Password: ');
        } else if (state === 'pass') {
          if (line === device.password) {
            state = 'shell';
            socket.write(`\r\nWelcome\r\n${device.prompt} `);
          } else {
            socket.write('\r\nLogin incorrect\r\nlogin: ');
            state = 'user';
          }
        } else {
          if (line.length > 0) {
            const body = device.responses[line];
            if (body !== undefined) {
              if (body.length > 0) socket.write(`${body.replace(/\n/g, '\r\n')}\r\n`);
            } else {
              socket.write('bad command name\r\n');
            }
          }
          if (!device.suppressCommandPrompt) socket.write(`${device.prompt} `);
        }
        idx = buf.indexOf('\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
