# Lab Equipment Reservation System

MERN application for reserving laboratory equipment. The project currently includes
the monorepo setup and secure API foundation from commits 01 and 02 of the plan in
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

`bun run build` produces `client/dist`. `bun run start` starts Express without
watch mode; production SPA serving and deployment are scheduled for commit 10.

## Structure and scope

- `client/src`: React application and base styles.
- `server/src/config`: environment validation.
- `server/src/db`: connection, local replica-set initialization, transaction check.
- `server/src/middleware`: validation, request IDs, security, limits, sessions, CSRF, errors.
- `server/src/routes`: versioned API router and health readiness.
- `server/src/shared`: safe logger, application errors, ObjectId validation.
- `server/src/app.js`: Express application factory.
- `server/src/server.js`: startup and graceful shutdown.
- `server/test`: configuration and API middleware integration tests.

Only dependencies used by the current increments are installed. Domain modules,
migration and seed commands, authentication, and client feature pages are added
with their planned commits.

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
  paths share a limit of 10 requests/15 minutes/IP, ready for commit 03.
- Startup explicitly creates the session TTL index and calls `createIndexes()`
  for all registered Mongoose models before listening. Domain schemas and their
  critical indexes will be added in their feature commits.
- Pino records request method, path, status, duration, request ID, and authenticated
  actor when present. It omits request bodies, headers, query values, and error
  messages that could contain secrets; unexpected failures retain stack frames.

Login, registration, and role-based authorization are scheduled for commit 03.
