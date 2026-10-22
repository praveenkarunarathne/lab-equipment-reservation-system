# Lab Equipment Reservation System

MERN application for reserving laboratory equipment. The project currently includes
the monorepo setup, API foundation, authentication, and equipment catalog from commits 01–04 of the plan in
[IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md).

## Prerequisites

- Node.js `24.21.0` (see `.node-version`). The package engine allows subsequent Node 24 patches.
- Bun `1.4.3` for dependency installation and package scripts.
- Docker with Docker Compose and permission to access the Docker daemon.

The implementation spec's npm workspace and lockfile instructions are adapted to
Bun workspaces and a committed `bun.lock`, following the project's working
preferences. Dependency versions remain pinned to the spec. Node runs the server
with native watch mode and environment-file loading.

## Local setup

From the repository root:

```sh
bun install --frozen-lockfile
cp .env.example .env
```

Generate a session secret and paste the output into `SESSION_SECRET` in `.env`:

```sh
bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Then start the database:

```sh
docker compose up -d --wait mongo
bun run db:replset-init
bun run db:check
```

The initialization command can be run repeatedly. It waits for an elected primary.
`db:check` commits a transaction that inserts, reads, and deletes its own temporary
record to verify transaction support; it leaves an empty `_setup_checks` collection.

Start the server and client in separate terminals:

```sh
bun run dev:server
```

```sh
bun run dev:client
```

Open <http://localhost:5173>. Express listens on port `3000` and connects to MongoDB
before accepting requests. Readiness is available at
<http://localhost:3000/api/v1/health>. Vite proxies `/api` requests to Express.

Local MongoDB uses:

```text
mongodb://localhost:27017/lab_equipment?replicaSet=rs0&directConnection=true
```

MongoDB is bound to the host loopback interface and persists data in the
`mongo-data` Docker volume. The single member advertises `localhost:27017`, and
the host connection uses `directConnection=true`. Run the application on the
host; this Compose configuration only runs the database.

Stop MongoDB while retaining its data:

```sh
docker compose down
```

## Checks and build

```sh
bun run lint
bun run format:check
bun run test
bun run build
```

`bun run format` formats project files. The original implementation spec is
excluded to preserve the supplied document. Vitest runs configuration tests and
Supertest integration tests against a temporary MongoDB `8.0.32` replica set.
Docker is not needed for tests; the first run downloads the MongoDB binary and
requires network access. Tests use their own database and random session secret.
React Testing Library tests cover forms, session bootstrapping, route guards,
CSRF rotation, and logout. Run either suite with `bun run test:server` or
`bun run test:client`.
Equipment tests also cover search, pagination, validation, admin permissions,
metadata editing, and the partial unique reservation index. Server suites run
sequentially to avoid competing MongoDB binary downloads on a fresh checkout.

`bun run build` produces `client/dist`. `bun run start` starts Express without
watch mode; production SPA serving and deployment are scheduled for commit 10.

## Structure and scope

- `client/src`: React authentication and equipment pages, session context, route guards, and styles.
- `server/src/config`: environment validation.
- `server/src/db`: connection, local replica-set initialization, transaction check.
- `server/src/middleware`: validation, request IDs, security, limits, sessions, CSRF, errors.
- `server/src/routes`: versioned API router and health readiness.
- `server/src/shared`: safe logger, application errors, ObjectId validation.
- `server/src/app.js`: Express application factory.
- `server/src/server.js`: startup and graceful shutdown.
- `server/src/modules`: auth and equipment modules, User model/DTO, and Reservation schema.
- `server/test`: configuration, API middleware, authentication, and authorization tests.

Only dependencies used by the current increments are installed. Equipment lifecycle,
reservation workflows, faults, and dashboard features follow in later commits.

## API foundation

- `GET /api/v1/health` performs a database ping with a two-second deadline. It
  returns `{ data: { status: "ok", database: "ok" } }`, or a safe JSON `503`.
- `GET /api/v1/auth/csrf` creates a pre-auth session and returns
  `{ data: { csrfToken } }`. Retain the cookie and send this token as
  `X-CSRF-Token` on unsafe API requests, with `Content-Type: application/json`.
- Unsafe requests check `Origin` (or `Referer` when Origin is absent) against
  `APP_ORIGIN`, reject cross-site fetches, and require the session's CSRF token.
- All API responses disable caching. Errors return
  `{ error: { code, message, fieldErrors?, requestId } }`; every request receives
  a generated `X-Request-Id`.
- Sessions live in MongoDB for eight hours. Production uses a secure,
  HTTP-only `__Host-lab.sid` cookie and trusts one proxy; development uses
  `lab.sid` over HTTP. `APP_ORIGIN` must be an exact origin and use HTTPS in
  production. `SESSION_SECRET` is now required at startup.
- General API requests allow 120 requests/minute/IP. Login and registration
  paths share a limit of 10 requests/15 minutes/IP.
- Startup explicitly creates the session TTL index and calls `createIndexes()`
  for all registered Mongoose models before listening. Domain schemas and their
  critical indexes will be added in their feature commits.
- Pino records request method, path, status, duration, request ID, and authenticated
  actor when present. It omits request bodies, headers, query values, and error
  messages that could contain secrets; unexpected failures retain stack frames.

## Authentication

Open <http://localhost:5173/register> to create a student account, then sign in at
<http://localhost:5173/login>. Registration does not sign you in automatically.
Passwords must contain 15–128 Unicode code points; spaces are preserved exactly.
Names and emails are trimmed, and emails are lowercased.

The API supports:

- `POST /api/v1/auth/register`: strict `{ name, email, password }`; creates a student.
- `POST /api/v1/auth/login`: `{ email, password }`; regenerates the session and
  returns `{ data: { user, csrfToken } }`. Replace the old CSRF token on success.
- `GET /api/v1/auth/me`: current user, or `401 AUTH_REQUIRED`.
- `POST /api/v1/auth/logout`: authenticated, CSRF required, no body needed; returns
  `204`, removes the stored session, and clears its cookie.

The browser keeps user and CSRF state in memory, and restores the session on
reload. Authoritative `401` responses clear the UI session. Route guards provide
navigation behavior; `requireAuth` and `requireRole` enforce API authorization.
Students land on the available equipment catalog. Administrators can manage
equipment from `/admin/equipment`; the dashboard follows in a later commit.

## Equipment catalog

- `/equipment`: authenticated catalog with submitted search/category/status filters,
  pagination, visible status labels, and links to equipment details. Students
  initially see available equipment and can select other statuses.
- `/equipment/:id`: equipment metadata, description, operational status, and reason.
- `/admin/equipment`: admin catalog with all current statuses and creation/edit links.
- `/admin/equipment/new` and `/admin/equipment/:id/edit`: admin metadata forms.

The API supports:

- `GET /api/v1/equipment`: authenticated list returning `{ data, pagination }`.
  `page` defaults to 1 (max 1,000,000); `limit` defaults to 12 (max 50).
  Optional filters are `q` (max 80), `category` (exact, case-insensitive, max 50),
  and `status` (`available`, `maintenance`, `unavailable`). Search matches literal
  text across name, asset code, category, and location. Results sort by name then
  asset code. Archived equipment is always excluded; the API has no default status.
- `GET /api/v1/equipment/:id`: non-archived equipment or a JSON `404`.
- `POST /api/v1/equipment`: admin and CSRF required; strict metadata body
  `{ assetCode, name, category, location, description? }`. Creates available equipment
  and records the admin's status audit. Asset codes are trimmed, uppercased, and unique.
- `PATCH /api/v1/equipment/:id`: admin and CSRF required; at least one metadata field.
  Operational status, archive data, and internal fields are rejected.

Startup creates equipment indexes and the Reservation schema's indexes, including
the unique active `(equipmentId, startAt)` index. Cancelled reservations can share
a slot, so cancellation history does not prevent rebooking. Booking APIs and
schedule validation are not exposed yet. Equipment status/archive workflows are
scheduled for commit 05.

## Seed an administrator

There is no public admin registration. Temporarily add these seed-only values to
your ignored `.env` file:

```dotenv
ADMIN_BOOTSTRAP_NAME=Lab Administrator
ADMIN_BOOTSTRAP_EMAIL=admin@example.com
ADMIN_BOOTSTRAP_PASSWORD=<a unique password of 15–128 Unicode characters>
```

Then run:

```sh
bun run db:seed-admin
```

Remove the bootstrap values from `.env` afterward. The seed uses the same
validation and Argon2id settings as registration. Repeating it leaves an existing
admin unchanged and refuses to promote or overwrite an existing student. It never
runs at server startup. Sign in normally with the seeded credentials to reach
`/admin`.
