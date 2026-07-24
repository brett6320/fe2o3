# Deployment guide

fe2o3 is a single Node.js process that serves the API, the web UI, and runs the
backup scheduler. It needs the `git` CLI on the host and (in production) a
PostgreSQL database.

## Requirements

- Node.js 22+ (bare-metal installs) or Docker
- `git` in `PATH`
- PostgreSQL 14+ for production (optional — see database section)
- Network reachability from the fe2o3 host to your devices (SSH/telnet)

## Environment variables

Everything else is configured in the web UI; these bootstrap the process.

| Variable | Default | Purpose |
|---|---|---|
| `FE2O3_PORT` | `8442` | HTTP listen port |
| `FE2O3_HOST` | `0.0.0.0` | Listen address |
| `FE2O3_DATA_DIR` | `./.data` | Data directory: git repos, PGlite database, secret key, plugin drivers |
| `FE2O3_DATABASE_URL` | *(unset)* | PostgreSQL connection string. Unset ⇒ embedded PGlite in the data dir |
| `FE2O3_SECRET_KEY` | auto-generated | Optional initial key, 64 hex chars (32 bytes). If unset, a keyring is generated at `<dataDir>/keys.json` on first boot |
| `FE2O3_BASE_URL` | `http://localhost:8442` | Public URL — **required for passkeys** (WebAuthn RP ID). This env var is authoritative; the Settings page value is not applied yet |
| `FE2O3_LOG_LEVEL` | `info` | pino log level |
| `FE2O3_COLLECTOR_POOL_SIZE` | `min(4, CPUs−1)` | Number of collector worker threads that run device backup sessions (minimum 1). Raise for more concurrent collections; each worker adds memory |

> **Back up** `<dataDir>/keys.json` (or `FE2O3_SECRET_KEY` if you pinned it).
> Without the keyring, stored device credentials and TOTP secrets cannot be
> decrypted.

### Encryption keyring & rotation

Secrets at rest (device credentials, TOTP secrets, device enable-password
vars) are AES-256-GCM encrypted with a versioned keyring at
`<dataDir>/keys.json`. Each stored blob names the key that sealed it. To
rotate (superadmin):

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_KEY" \
  https://fe2o3.example.com/api/v1/admin/keys/rotate
# → {"activeKeyId":"2","rotated":{"credentialSecrets":8,"totpSecrets":2,"deviceVars":1}}
```

The new key is persisted before any data is re-encrypted, so an interruption
at any point leaves everything decryptable. Once rotation succeeds, retire the
old key with `DELETE /api/v1/admin/keys/<id>`; `GET /api/v1/admin/keys` lists
key ids and the active one. Legacy single-key installs (`secret.key`) migrate
into the keyring automatically on first boot.

## Database

- **Embedded (default):** with `FE2O3_DATABASE_URL` unset, fe2o3 runs PGlite — a
  full Postgres engine embedded in-process, stored under `<dataDir>/pg`. Zero
  dependencies; fine for labs and small installs.
- **PostgreSQL (production):**

  ```bash
  createdb fe2o3
  export FE2O3_DATABASE_URL=postgres://fe2o3:password@db.internal:5432/fe2o3
  ```

  Migrations run automatically at startup. The same single schema is used in
  both modes, so you can move from PGlite to Postgres by exporting/importing
  with standard pg tools.

## Docker

```bash
docker build -t fe2o3 .
docker run -d --name fe2o3 \
  -p 8442:8442 \
  -v fe2o3-data:/data \
  -e FE2O3_BASE_URL=https://fe2o3.example.com \
  -e FE2O3_DATABASE_URL=postgres://fe2o3:pw@db:5432/fe2o3 \
  fe2o3
```

For docker-compose, use the Traefik template below — it keeps all secrets in
gitignored external files (`fe2o3.env`, `secrets/db_password`) rather than in
the compose file itself.

## Bare Node

```bash
corepack enable pnpm
pnpm install --prod=false
pnpm --filter @fe2o3/web build       # build the SPA (served by the API process)
FE2O3_DATA_DIR=/var/lib/fe2o3 \
FE2O3_BASE_URL=https://fe2o3.example.com \
pnpm --filter @fe2o3/server start
```

systemd unit example:

```ini
[Unit]
Description=fe2o3 config backup
After=network-online.target

[Service]
User=fe2o3
WorkingDirectory=/opt/fe2o3
Environment=FE2O3_DATA_DIR=/var/lib/fe2o3
Environment=FE2O3_BASE_URL=https://fe2o3.example.com
Environment=FE2O3_DATABASE_URL=postgres://fe2o3:pw@localhost/fe2o3
ExecStart=/usr/bin/pnpm --filter @fe2o3/server start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Reverse proxy / TLS

Passkeys and secure cookies require HTTPS in production. Example nginx:

```nginx
server {
  listen 443 ssl http2;
  server_name fe2o3.example.com;
  ssl_certificate     /etc/letsencrypt/live/fe2o3.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/fe2o3.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8442;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    # SSE (live dashboard) needs buffering off
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

Set `FE2O3_BASE_URL=https://fe2o3.example.com` so WebAuthn binds to the right
origin.

### Traefik

A ready-made compose template is provided at
[`docker-compose.traefik.yml`](../docker-compose.traefik.yml). It assumes an
external `traefik` network, a `letsencrypt-prd` cert resolver, and a global
HTTP→HTTPS redirect on the `web` entrypoint (so only the `websecure` router is
declared). The template includes a buffering middleware so SSE events flush
through Traefik immediately. Edit the hostname and network name, then provide
the secret files — they are kept out of the compose file:

```bash
cp fe2o3.env.example fe2o3.env                     # database URL (contains the db password)
cp secrets/db_password.example secrets/db_password # postgres password (Docker secret)
# edit both — the password must match in each — then:
docker compose -f docker-compose.traefik.yml up -d
```

Both files are gitignored; only the `.example` templates are committed.

## Backing up fe2o3 itself

Three things matter:

1. The database (pg_dump, or the `<dataDir>/pg` directory in embedded mode)
2. `<dataDir>/repos/` — the per-org git repositories with all config history
3. `<dataDir>/keys.json` — the encryption keyring

The git repos are plain repositories — you can also `git remote add` a mirror
inside each and push from cron for off-site copies.

## Upgrades

Pull the new version and restart; database migrations apply automatically on
boot. Interrupted backup jobs are marked failed and rescheduled.
