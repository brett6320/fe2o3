/** Shared helpers for parsing device uptime into seconds. */

const UNIT_SECONDS: Record<string, number> = {
  y: 365 * 86400, // approximate
  w: 604800,
  d: 86400,
  h: 3600,
  m: 60,
  s: 1,
};

/**
 * Verbose duration like "20 weeks, 4 days, 1 hour, 43 minutes" or
 * "3 weeks, 2 days, 1 hour and 5 minutes" (Cisco/Arista style).
 */
export function parseVerboseDuration(text: string): number | null {
  let total = 0;
  let matched = false;
  for (const m of text.matchAll(
    /(\d+)\s*(years?|weeks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)/gi,
  )) {
    const unit = m[2]?.[0]?.toLowerCase() ?? '';
    total += Number(m[1]) * (UNIT_SECONDS[unit] ?? 0);
    matched = true;
  }
  return matched ? total : null;
}

/** Compact duration like "1w2d3h4m5s" (MikroTik RouterOS). */
export function parseCompactDuration(text: string): number | null {
  let total = 0;
  let matched = false;
  for (const m of text.matchAll(/(\d+)\s*([wdhms])/gi)) {
    total += Number(m[1]) * (UNIT_SECONDS[m[2]?.toLowerCase() ?? ''] ?? 0);
    matched = true;
  }
  return matched ? total : null;
}

/** A plain seconds value (Cradlepoint status, `/proc/uptime` first field). */
export function parseSeconds(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * Linux/BSD `uptime` line: "… up 85 days, 21:00, …", "… up 3 mins",
 * "… up 21:00, …", "… up 1 day, 2:03, …".
 */
export function parseBsdUptime(text: string): number | null {
  const m = /\bup\s+(.+?)(?:,\s*\d+\s+users?|,\s*load|$)/i.exec(text);
  if (!m?.[1]) return null;
  const seg = m[1];
  let total = 0;
  let matched = false;
  const days = /(\d+)\s+days?/i.exec(seg);
  if (days) {
    total += Number(days[1]) * 86400;
    matched = true;
  }
  const mins = /(\d+)\s+min/i.exec(seg);
  if (mins) {
    total += Number(mins[1]) * 60;
    matched = true;
  }
  const hm = /(\d+):(\d{2})/.exec(seg);
  if (hm) {
    total += Number(hm[1]) * 3600 + Number(hm[2]) * 60;
    matched = true;
  }
  return matched ? total : null;
}

/**
 * JunOS `show system uptime` — the parenthetical after "System booted",
 * e.g. "(12w3d 21:00 ago)". Falls back to the BSD `up …` line.
 */
export function parseJunosUptime(text: string): number | null {
  const m = /System booted:.*?\((?:(\d+)w)?\s*(?:(\d+)d)?\s*(\d+):(\d{2})\s*ago\)/i.exec(text);
  if (m) {
    return (
      Number(m[1] ?? 0) * 604800 +
      Number(m[2] ?? 0) * 86400 +
      Number(m[3] ?? 0) * 3600 +
      Number(m[4] ?? 0) * 60
    );
  }
  return parseBsdUptime(text);
}
