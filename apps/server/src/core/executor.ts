import type { DriverSpec } from '@fe2o3/driver-sdk';
import { connectSsh } from './input/ssh.js';
import { connectTelnet } from './input/telnet.js';
import type { ConnectOptions, Transport } from './input/transport.js';

export interface ExecutorResult {
  configText: string;
  transcript: string;
  /** Volatile uptime stat in seconds (never part of the config), if parsed. */
  uptimeSeconds?: number | undefined;
}

export interface DeviceSession {
  driver: DriverSpec;
  protocol?: 'ssh' | 'telnet';
  connect: ConnectOptions;
  enablePassword?: string | undefined;
}

// IOS renders `--More--` in reverse video with trailing ANSI/cursor/erase
// sequences (e.g. `\x1b[7m --More-- \x1b[m\r        \r`), and matching runs
// against the raw, un-stripped buffer — so tolerate any trailing whitespace,
// backspaces, carriage returns, or ANSI escape sequences before end-of-buffer.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching terminal control output
const MORE_PROMPT = /(?:--\s?More\s?--|<--- More --->)(?:\x1b\[[0-9;?]*[A-Za-z]|[\s\b\r])*$/;

/**
 * Wait for `pattern`, transparently continuing through `--More--` pagination
 * (long login banners page before `terminal length 0` can be sent).
 */
async function expectPaged(
  transport: Transport,
  pattern: RegExp,
  timeoutMs?: number,
): Promise<string> {
  let out = '';
  for (let i = 0; i < 500; i++) {
    const combined = new RegExp(`(?:${pattern.source})|(?:${MORE_PROMPT.source})`, 'm');
    const chunk = await transport.expect(combined, timeoutMs);
    out += chunk;
    if (pattern.test(chunk)) return out;
    // matched the pagination prompt — space advances one page
    await transport.sendRaw(' ');
  }
  throw new Error('pagination did not terminate after 500 pages');
}

/** Strip ANSI escapes and normalize line endings. */
function cleanOutput(raw: string): string {
  return (
    raw
      // NUL bytes: some gear (Digi Sarian) emits them; Postgres text rejects 0x00
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping NUL
      .replace(/\x00/g, '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      // pagination prompt plus the backspace/space runs devices use to erase it
      .replace(/(?:--\s?More\s?--|<--- More --->)/g, '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: backspace erasure cleanup
      .replace(/ *\x08+ *\x08*/g, '')
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
  const eol = driver.lineEnding ?? '\n';
  const sendCmd = (line: string) => transport.sendRaw(`${line}${eol}`);
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
    await expectPaged(transport, driver.prompt);

    if (driver.enable && session.enablePassword) {
      await sendCmd(driver.enable.cmd);
      const res = await expectPaged(
        transport,
        new RegExp(`(?:${driver.enable.passPrompt.source})|(?:${driver.prompt.source})`, 'm'),
      );
      if (driver.enable.passPrompt.test(res)) {
        await sendCmd(session.enablePassword);
        await expectPaged(transport, driver.prompt);
      }
    }

    for (const step of driver.init ?? []) {
      await sendCmd(step.cmd);
      await expectPaged(transport, step.expect ?? driver.prompt);
    }

    const sections: string[] = [];
    // Some CLIs don't reprint the prompt after a command over a non-interactive
    // session (Digi TransPort/Sarian ends each command with a bare `OK`), so a
    // driver may set commandComplete to detect end-of-output instead.
    const commandDone = driver.commandComplete ?? driver.prompt;
    for (const spec of driver.commands) {
      await sendCmd(spec.cmd);
      const raw = await expectPaged(transport, commandDone);
      const errorMatch = (driver.errorPatterns ?? []).map((p) => raw.match(p)?.[0]).find(Boolean);
      if (errorMatch) {
        // Unsupported optional command (e.g. `show inventory` on older IOS):
        // skip its section rather than failing the whole backup.
        if (spec.optional) continue;
        throw new Error(`command "${spec.cmd}" failed: ${errorMatch}`);
      }
      let body = extractBody(raw, spec.cmd);
      if (spec.transform) body = spec.transform(body);
      if (spec.name) {
        sections.push(`${driver.comment}--- ${spec.name} ---\n${body}`);
      } else {
        sections.push(body);
      }
    }

    const rawConfig = `${sections.join('\n\n')}\n`;
    let configText = rawConfig;
    for (const scrub of driver.scrubbers) configText = scrub(configText);

    // Uptime is a volatile *stat*, never part of the committed config. Parse it
    // from a dedicated command's output (not committed) or, when the driver has
    // no `cmd`, from the pre-scrub collected config (e.g. IOS `show version`).
    // Best-effort: a stat failure must never fail the backup.
    let uptimeSeconds: number | undefined;
    if (driver.uptime) {
      try {
        let src = rawConfig;
        if (driver.uptime.cmd) {
          await sendCmd(driver.uptime.cmd);
          const raw = await expectPaged(transport, commandDone, 20_000);
          src = extractBody(raw, driver.uptime.cmd);
        }
        const secs = driver.uptime.parse(src);
        if (secs != null && Number.isFinite(secs) && secs >= 0) uptimeSeconds = Math.floor(secs);
      } catch {
        // ignore — uptime is best-effort
      }
    }

    return { configText, transcript: cleanOutput(transport.transcript()), uptimeSeconds };
  } finally {
    await transport.close();
  }
}
