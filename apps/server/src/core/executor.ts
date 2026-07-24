import type { DriverSpec } from '@fe2o3/driver-sdk';
import { connectSsh } from './input/ssh.js';
import { connectTelnet } from './input/telnet.js';
import type { ConnectOptions, Transport } from './input/transport.js';

export interface ExecutorResult {
  configText: string;
  transcript: string;
}

export interface DeviceSession {
  driver: DriverSpec;
  protocol?: 'ssh' | 'telnet';
  connect: ConnectOptions;
  enablePassword?: string | undefined;
}

/** Strip ANSI escapes and normalize line endings. */
function cleanOutput(raw: string): string {
  return (
    raw
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  );
}

/** Remove the echoed command from the head and the trailing prompt line. */
function extractBody(raw: string, cmd: string): string {
  const text = cleanOutput(raw);
  const lines = text.split('\n');
  if (lines[0]?.trim().endsWith(cmd.trim())) lines.shift();
  // Drop trailing prompt line (last non-empty line, which re-matched the prompt)
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  if (lines.length > 0) lines.pop();
  return lines.join('\n');
}

/**
 * Drive one full backup session: login → enable → init → run each command,
 * assemble section-labelled output, apply the driver's scrubbers.
 */
export async function runBackup(session: DeviceSession): Promise<ExecutorResult> {
  const { driver } = session;
  const telnet = session.protocol === 'telnet';
  const transport: Transport = telnet
    ? await connectTelnet(session.connect)
    : await connectSsh(session.connect);
  try {
    if (telnet) {
      const login = driver.telnetLogin ?? {
        userPrompt: /(?:login|[Uu]sername):\s?$/m,
        passPrompt: /[Pp]assword:\s?$/m,
      };
      await transport.expect(login.userPrompt);
      await transport.send(session.connect.username);
      await transport.expect(login.passPrompt);
      await transport.send(session.connect.password ?? '');
    }
    await transport.expect(driver.prompt);

    if (driver.enable && session.enablePassword) {
      await transport.send(driver.enable.cmd);
      const res = await transport.expect(
        new RegExp(`(?:${driver.enable.passPrompt.source})|(?:${driver.prompt.source})`, 'm'),
      );
      if (driver.enable.passPrompt.test(res)) {
        await transport.send(session.enablePassword);
        await transport.expect(driver.prompt);
      }
    }

    for (const step of driver.init ?? []) {
      await transport.send(step.cmd);
      await transport.expect(step.expect ?? driver.prompt);
    }

    const sections: string[] = [];
    for (const spec of driver.commands) {
      await transport.send(spec.cmd);
      const raw = await transport.expect(driver.prompt);
      for (const pattern of driver.errorPatterns ?? []) {
        if (pattern.test(raw)) {
          throw new Error(`command "${spec.cmd}" failed: ${raw.match(pattern)?.[0]}`);
        }
      }
      let body = extractBody(raw, spec.cmd);
      if (spec.transform) body = spec.transform(body);
      if (spec.name) {
        sections.push(`${driver.comment}--- ${spec.name} ---\n${body}`);
      } else {
        sections.push(body);
      }
    }

    let configText = `${sections.join('\n\n')}\n`;
    for (const scrub of driver.scrubbers) configText = scrub(configText);

    return { configText, transcript: cleanOutput(transport.transcript()) };
  } finally {
    await transport.close();
  }
}
