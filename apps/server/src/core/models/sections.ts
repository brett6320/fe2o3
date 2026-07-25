/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract a named `<comment>--- <name> ---` section body from an assembled
 * config — the section-labelled output the executor produces. Returns '' when
 * the section isn't present. `comment` is the driver's comment prefix (`! `,
 * `# `, …).
 */
export function section(config: string, name: string, comment: string): string {
  const c = escapeRegExp(comment);
  const m = new RegExp(`^${c}--- ${name} ---$`, 'm').exec(config);
  if (!m) return '';
  const rest = config.slice(m.index + m[0].length);
  const next = rest.search(new RegExp(`^${c}--- .+ ---$`, 'm'));
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}
