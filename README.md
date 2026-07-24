# fe2o3

Modern network device configuration backup — a ground-up reimagining of
[Oxidized](https://github.com/ytti/oxidized) with a polished web UI, a rich REST API,
and multi-tenant organizations.

fe2o3 logs into your network devices on a schedule, captures their configuration,
scrubs secrets and volatile noise, and commits every change to a per-organization
git repository. Browse configs, compare versions, and get notified the moment
something changes.

## Highlights

- **Web-managed everything** — devices, groups, credentials, hooks, users, and
  instance settings are all configured through the UI (or the API). No YAML files.
- **Multi-tenant** — organizations with per-org roles (`admin`, `operator`,
  `readonly`), each with its own isolated git repository.
- **Git-versioned configs** — one repo per org, one file per device, full history,
  diffs, and no-op detection so unchanged backups create no commits.
- **Vendor drivers** — Cisco IOS/IOS-XE, Juniper JunOS, Arista EOS, MikroTik
  RouterOS, Ubiquiti EdgeOS, and generic Linux/VyOS built in; drop-in plugin
  drivers for anything else.
- **SSH and telnet** transports, including legacy key-exchange/cipher support for
  old gear.
- **Security first** — argon2id passwords, TOTP and passkey (WebAuthn) MFA,
  scoped API keys, AES-256-GCM encrypted device credentials, audit log.
- **Realtime** — live dashboard and job feed over server-sent events.
- **Polished UI** — React + Tailwind, dark/light theme.
- **Simple deployment** — single Node process; embedded Postgres (PGlite) out of
  the box, real PostgreSQL in production via one env var.

## Quick start

```bash
# requirements: Node 22+, git, pnpm (via corepack)
corepack enable pnpm
pnpm install
pnpm dev             # API on :8442, UI on :5173 (proxied)
```

Open http://localhost:5173, complete the setup wizard (creates the first
superadmin and organization), add a credential, a group, and a device — then hit
**Backup now**.

Or with Docker:

```bash
docker build -t fe2o3 .
docker run -p 8442:8442 -v fe2o3-data:/data fe2o3
```

## Documentation

- [Deployment guide](docs/deployment.md) — Docker, bare Node, PostgreSQL,
  reverse proxy/TLS, environment variables, backups of fe2o3 itself
- [User guide](docs/user-guide.md) — setup wizard, orgs and roles, devices,
  credentials, versions and diffs, hooks, MFA enrollment
- [API guide](docs/api.md) — authentication, API keys, endpoints, examples
- [Driver guide](docs/drivers.md) — how drivers work and how to write your own

Interactive OpenAPI docs are served by the app itself at [`/api/docs`](http://localhost:8442/api/docs).

## Development

```bash
pnpm dev         # server (tsx watch) + web (vite) together
pnpm test        # vitest — includes e2e against an in-process fake SSH device
pnpm typecheck   # strict TS across the workspace
pnpm lint        # biome
```

Repository layout:

```
apps/server      Fastify API, scheduler, drivers, git pipeline
apps/web         React SPA (Vite, Tailwind, TanStack Router/Query)
packages/shared  zod schemas shared between server and web
packages/driver-sdk  public driver contract for vendor plugins
```

## License

MIT
