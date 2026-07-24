# API guide

Base path: `/api/v1`. Interactive OpenAPI reference: **`/api/docs`** (generated
from the same zod schemas that validate every request).

## Authentication

Two mechanisms:

1. **Session cookie** — `POST /auth/login`, then the `fe2o3_session` httpOnly
   cookie authenticates requests. Used by the web UI. If the account has TOTP
   enabled, the session starts *MFA-pending* and only `/auth/mfa/*` works until
   `POST /auth/mfa/totp` succeeds.
2. **API key** — `Authorization: Bearer fe2o3_<prefix>_<secret>`. Create keys in
   the UI (or `POST /api-keys`). Scope `read` = GET only; `write` adds
   mutations; `admin` adds superadmin routes. Org-level roles still apply on
   org-scoped routes. API keys are never MFA-pending.

```bash
curl -H "Authorization: Bearer fe2o3_ab12cd34_..." \
  https://fe2o3.example.com/api/v1/orgs/$ORG/devices
```

## Endpoint map

System / auth:

| Method & path | Notes |
|---|---|
| `GET /health` | liveness, no auth |
| `GET /setup/status` · `POST /setup` | first-boot wizard |
| `POST /auth/login` · `POST /auth/logout` · `GET /auth/session` | password sessions |
| `POST /auth/mfa/totp` | complete MFA step-up |
| `POST /auth/webauthn/options` · `POST /auth/webauthn/verify` | passkey login |

Profile & personal security:

| Method & path | Notes |
|---|---|
| `POST /profile/password` | change own password |
| `POST /profile/totp/enroll` · `/confirm` · `/disable` | TOTP lifecycle |
| `GET/POST/DELETE /profile/passkeys[...]` | passkey management |
| `GET/POST/DELETE /api-keys[/:id]` | API keys (secret returned once) |

Admin (superadmin):

| Method & path | Notes |
|---|---|
| `GET/POST/PATCH/DELETE /users[/:id]` | user accounts |
| `GET/POST/DELETE /orgs[/:orgId]` | organizations |
| `GET/PATCH /settings` | instance settings |

Org-scoped (`/orgs/:orgId/...`, role in parentheses):

| Method & path | Notes |
|---|---|
| `GET/PUT/DELETE .../members` | memberships (admin to modify) |
| `GET/POST/PATCH/DELETE .../credentials[/:id]` | secrets write-only (admin) |
| `GET/POST/PATCH/DELETE .../groups[/:id]` | groups (admin) |
| `GET/POST/PATCH/DELETE .../devices[/:id]` | devices (admin) |
| `POST .../devices/import` | CSV bulk import (admin) |
| `POST .../devices/:id/backup` | run now (operator) |
| `GET .../devices/:id/versions` | commit list |
| `GET .../devices/:id/versions/:sha` | config content at version |
| `GET .../devices/:id/diff?from=&to=` | unified diff between shas |
| `GET .../devices/:id/jobs` · `GET .../jobs/:id` | job history / transcript (operator) |
| `GET .../jobs?limit=` | org-wide job list |
| `GET .../stats` | dashboard counters |
| `GET .../events` | **SSE** stream of job/device events |
| `GET/POST/PATCH/DELETE .../hooks[/:id]` · `POST .../hooks/:id/test` | notifications (admin) |

Other: `GET /models` lists registered drivers and their device variables.

## Examples

Create a device and back it up:

```bash
ORG=... AUTH="Authorization: Bearer $TOKEN"
GROUP=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"Core","pathSlug":"core"}' \
  https://fe2o3.example.com/api/v1/orgs/$ORG/groups | jq -r .id)

DEV=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"core-sw1\",\"host\":\"10.0.0.1\",\"modelId\":\"ios\",\"groupId\":\"$GROUP\"}" \
  https://fe2o3.example.com/api/v1/orgs/$ORG/devices | jq -r .id)

curl -s -X POST -H "$AUTH" \
  https://fe2o3.example.com/api/v1/orgs/$ORG/devices/$DEV/backup
# → {"jobId":"…","status":"success","commitSha":"…"}
```

Fetch the latest config:

```bash
SHA=$(curl -s -H "$AUTH" .../devices/$DEV/versions | jq -r '.[0].sha')
curl -s -H "$AUTH" .../devices/$DEV/versions/$SHA | jq -r .content
```

Follow live events:

```bash
curl -N -H "$AUTH" https://fe2o3.example.com/api/v1/orgs/$ORG/events
# data: {"type":"job.finished","deviceName":"core-sw1","status":"success",...}
```

Webhook verification (Node):

```js
import { createHmac } from 'node:crypto';
const expected = createHmac('sha256', SECRET).update(rawBody).digest('hex');
const ok = expected === req.headers['x-fe2o3-signature'];
```

## Errors

Errors are JSON: `{"statusCode": 409, "error": "Conflict", "message": "…"}`.
Validation failures return 400 with zod details. 401 = not authenticated (or
MFA pending); 403 = authenticated but insufficient role/scope.
