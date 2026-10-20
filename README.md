# Lab Equipment Reservation System

MERN application for reserving laboratory equipment. This first increment sets up
the JavaScript ESM monorepo, React/Vite client, Express server, and local MongoDB
replica set described in [IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md).

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
before accepting requests. Its setup response is available at
<http://localhost:3000/>. Vite proxies `/api` requests to Express for subsequent API
implementation.

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
excluded to preserve the supplied document. Vitest runs the setup smoke tests;
the feature integration and component suites belong to subsequent commits.

`bun run build` produces `client/dist`. `bun run start` starts Express without
watch mode; production SPA serving and deployment are scheduled for commit 10.

## Structure and scope

- `client/src`: React application and base styles.
- `server/src/config`: environment validation.
- `server/src/db`: connection, local replica-set initialization, transaction check.
- `server/src/app.js`: Express application factory.
- `server/src/server.js`: startup and graceful shutdown.
- `server/test`: setup smoke tests.

Only dependencies used in this increment are installed. Domain modules, routing,
security middleware, database indexes, migration and seed commands, authentication,
and feature tests are added with their planned commits rather than empty stubs.

`.env` is ignored. `APP_ORIGIN`, `SESSION_SECRET`, and `LOG_LEVEL` are documented in
`.env.example` for the upcoming security foundation; they are not consumed by the
setup server. Generate a session secret before implementing authentication:

```sh
bun -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
