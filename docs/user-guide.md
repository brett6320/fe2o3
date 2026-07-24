# User guide

## First boot: the setup wizard

Browse to fe2o3 and you'll land on `/setup`. Create the first account — it
becomes the **superadmin** — and your first **organization**. You're signed in
when the wizard finishes.

## Concepts

- **Organization (org)** — a tenant. Devices, groups, credentials, hooks, and
  job history are all org-scoped, and each org has its own git repository.
- **Membership & roles** — users are global accounts; access is granted per org:
  - `readonly` — view devices, configs, versions, diffs, jobs
  - `operator` — readonly + trigger backups, view job transcripts
  - `admin` — operator + manage devices, groups, credentials, hooks, members
- **Superadmin** — a global flag; manages users, orgs, and instance settings,
  and implicitly has admin in every org.
- **Group** — a set of devices; maps to a subdirectory in the org's git repo and
  provides default credential and backup interval.
- **Credential** — login secrets (username/password, enable password, SSH private
  key + passphrase). Encrypted at rest; **write-only** — values are never
  returned by UI or API, only `has…` flags.
- **Model / driver** — how fe2o3 talks to a vendor's CLI (see Models page).

Use the org switcher at the top of the sidebar if you belong to several orgs.

## Backing up your first device

1. **Credentials** → *Add credential* — the device login. Password and/or an
   SSH private key (PEM/OpenSSH) with optional passphrase; key auth is used
   automatically when present.
2. **Groups** → *Add group* — e.g. `Core` with path slug `core`; pick the
   default credential and interval.
3. **Devices** → *Add device* — name (becomes the git filename), host, port,
   model, group, and optionally a credential (blank = the group's default).
4. Open the device page → **Backup now**.

The **Overview** tab (default) summarizes the generally-static device facts —
name, host, model, protocol, status — alongside hardware details parsed from the
latest backup: serial number, hardware model, OS version, and a hardware
inventory table. Parsing is per-driver and best-effort (Cisco IOS today); models
without a parser just show the basic fields, and hardware details appear once the
device has been backed up. The **Config** tab shows the latest capture with a version dropdown — the
selected version's sha is kept in the URL (`?sha=…`), so a specific version can
be bookmarked or shared. The **Versions** tab lets you pick two versions and
see a colorized diff. The **Jobs** tab lists every run; admins/operators can
expand a job to read the full session transcript (secrets scrubbed). Admins
also get an **Edit** tab: rename, move group (both preserved in git history),
change host/port/protocol/model, override the credential or interval, and
enable/disable scheduling.

Backups then run automatically on the device interval (or its group's default).
Failures back off exponentially (interval × 2ⁿ, capped at 6 h) and show on the
dashboard.

### CSV bulk import

**Devices → API** `POST /orgs/:orgId/devices/import` with a CSV body:

```csv
name,host,model,group,port,protocol
core-sw1,10.0.0.1,ios,core
edge-r1,10.0.1.1,routeros,edge,22
old-switch,10.0.2.9,ios,legacy,23,telnet
```

`group` is the group path slug. The response reports created rows and per-line
skip reasons.

## Hooks (notifications)

**Hooks** → *Add hook*:

- **Webhook** — JSON POST to your URL on the selected events; optional HMAC
  secret adds an `X-Fe2o3-Signature` header (hex SHA-256 of the body).
- **Slack** — incoming-webhook message on change/failure.

Events: `backup_changed` (new commit), `backup_failed`, `backup_success` (every
successful run, changed or not). Use *Test* to fire a sample delivery.

## MFA

On **Profile**:

- **TOTP** — *Set up TOTP*, scan the QR with any authenticator app, confirm a
  code. Sign-ins then require a code after the password.
- **Passkeys** — *Add passkey* registers Touch ID / security key / phone. The
  login page's *Sign in with passkey* button is usernameless and satisfies MFA
  by itself. Requires the instance to be served over HTTPS with a correct
  `FE2O3_BASE_URL`.

Superadmins can reset a locked-out user's password via the API
(`PATCH /users/:id` with `password`); disabling a user from **Users** kills
their sessions immediately.

## API keys

**API keys** → *Create*. The full token (`fe2o3_<prefix>_<secret>`) is shown
**once**. Scopes:

- `read` — GET only
- `write` — read + mutations, org roles still apply
- `admin` — full access including superadmin routes (if your account is one)

Keys can expire, show last-used time, and can be revoked instantly.

## Audit log (superadmin)

**Audit** lists every authenticated mutating API call — who (user or API key),
action, resource, IP, timestamp.

## Settings (superadmin)

- **Base URL**, **Git author**, **Concurrency** — stored for upcoming use.
  > **Note:** these values are not applied yet. Today the passkey origin comes
  > from the `FE2O3_BASE_URL` environment variable, backup commits are authored
  > as `fe2o3 <fe2o3@localhost>`, and collection concurrency is set by
  > `FE2O3_COLLECTOR_POOL_SIZE` (the number of collector worker threads).

## Collector pool

Device backups run on a pool of **collector worker threads** — the long-running
SSH/telnet sessions execute off the main event loop, so a slow or misbehaving
device can't stall the API or the scheduler. The scheduler decides what is due
and enqueues work; idle collectors pick it up. Git commits and database writes
stay on the main thread. Size the pool with `FE2O3_COLLECTOR_POOL_SIZE`
(minimum 1); if a worker crashes mid-backup the task is retried inline and the
worker is replaced.

## The git repositories

Each org's repo lives at `<dataDir>/repos/<org-slug>` with one file per device
under its group directory (`core/core-sw1`). They're normal git repos — clone
them, add remotes, or point existing oxidized tooling at them.
