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
| `FE2O3_SECRET_KEY` | auto-generated | 64 hex chars (32 bytes) — AES-256-GCM key for credentials at rest. Auto-generated into `<dataDir>/secret.key` on first boot if unset |
| `FE2O3_BASE_URL` | `http://localhost:8442` | Public URL — **required for passkeys** (WebAuthn RP ID) |
| `FE2O3_LOG_LEVEL` | `info` | pino log level |

> **Back up** `FE2O3_SECRET_KEY` / `<dataDir>/secret.key`. Without it, stored
> device credentials and TOTP secrets cannot be decrypted.

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

docker-compose:

```yaml
services:
  fe2o3:
    build: .
    ports: ["8442:8442"]
    volumes: ["fe2o3-data:/data"]
    environment:
      FE2O3_BASE_URL: https://fe2o3.example.com
      FE2O3_DATABASE_URL: postgres://fe2o3:pw@db:5432/fe2o3
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: fe2o3
      POSTGRES_PASSWORD: pw
      POSTGRES_DB: fe2o3
    volumes: ["pg-data:/var/lib/postgresql/data"]
volumes:
  fe2o3-data:
  pg-data:
```

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

## Backing up fe2o3 itself

Three things matter:

1. The database (pg_dump, or the `<dataDir>/pg` directory in embedded mode)
2. `<dataDir>/repos/` — the per-org git repositories with all config history
3. `<dataDir>/secret.key` (or the `FE2O3_SECRET_KEY` value)

The git repos are plain repositories — you can also `git remote add` a mirror
inside each and push from cron for off-site copies.

## Upgrades

Pull the new version and restart; database migrations apply automatically on
boot. Interrupted backup jobs are marked failed and rescheduled.
