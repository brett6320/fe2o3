/**
 * fe2o3 driver SDK — the public contract for vendor device drivers.
 *
 * A driver describes how to talk to one class of network device:
 * how to recognize its prompt, which commands produce the configuration,
 * and how to scrub volatile or secret content before it is committed.
 */

/** A single line sent during session setup (e.g. `terminal length 0`). */
export interface Step {
  cmd: string;
  /** Wait for this pattern instead of the main prompt (e.g. a password prompt). */
  expect?: RegExp;
}

/** One command whose output contributes to the backed-up configuration. */
export interface CommandSpec {
  cmd: string;
  /** Section heading emitted (with the driver comment prefix) above the output. */
  name?: string;
  /** Post-process raw output (strip banners, pagination artifacts, etc.). */
  transform?: (raw: string) => string;
  /**
   * When true, an error match (per the driver's errorPatterns) skips this
   * command instead of failing the whole backup — for commands not supported
   * on every platform in a family (e.g. `show inventory` on older Cisco gear).
   */
  optional?: boolean;
}

/** Rewrites config text to remove secrets and volatile noise before commit. */
export type Scrubber = (text: string) => string;

export interface TelnetLoginSpec {
  userPrompt: RegExp;
  passPrompt: RegExp;
}

export interface EnableSpec {
  cmd: string;
  passPrompt: RegExp;
}

/** JSON-schema-ish description of a per-device variable a driver understands. */
export interface DriverVar {
  key: string;
  description: string;
  type: 'string' | 'number' | 'boolean';
  default?: string | number | boolean;
}

export interface DriverSpec {
  /** Stable identifier, e.g. `ios`. Used as `devices.model_id`. */
  id: string;
  displayName: string;
  /** Matches the device CLI prompt at end of output. */
  prompt: RegExp;
  /** Output matching any of these fails the command (e.g. `% Invalid input`). */
  errorPatterns?: RegExp[];
  /** Comment prefix for section headers in the stored config, e.g. `! `. */
  comment: string;
  init?: Step[];
  commands: CommandSpec[];
  scrubbers: Scrubber[];
  telnetLogin?: TelnetLoginSpec;
  enable?: EnableSpec;
  /**
   * Line terminator sent to submit a command. Most gear accepts `\n`; some
   * (e.g. MikroTik RouterOS) only treat carriage return as Enter. Default `\n`.
   */
  lineEnding?: '\n' | '\r' | '\r\n';
  /**
   * End-of-command-output marker, used instead of `prompt` when a device
   * doesn't reprint its prompt after a command over a non-interactive session
   * (e.g. Digi TransPort/Sarian terminates every command with a bare `OK`).
   * `prompt` is still used for the initial login.
   */
  commandComplete?: RegExp;
  /** Per-device variables this driver honors (shown in the UI device form). */
  vars?: DriverVar[];
}

/** Helper preserving inference; drivers `export default defineDriver({...})`. */
export function defineDriver(spec: DriverSpec): DriverSpec {
  return spec;
}

/** Replace the capture group of `pattern` with a hidden marker, keeping context. */
export function hideSecret(pattern: RegExp, replacement = '<secret hidden>'): Scrubber {
  return (text) =>
    text.replace(pattern, (match, secret: string) =>
      typeof secret === 'string' ? match.replace(secret, replacement) : replacement,
    );
}

/** Drop entire lines matching the pattern. */
export function dropLines(pattern: RegExp): Scrubber {
  return (text) =>
    text
      .split('\n')
      .filter((line) => !pattern.test(line))
      .join('\n');
}
