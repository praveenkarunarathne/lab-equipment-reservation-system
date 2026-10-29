# Lab Equipment Reservation System

MERN application for reserving laboratory equipment. Includes authentication,
equipment management, conflict-safe booking, fault reporting, an admin dashboard,
production serving, CI and deployment configuration from the 10-commit plan in
[IMPLEMENTATION_SPEC.md](IMPLEMENTATION_SPEC.md).

## Prerequisites

- Node.js `24.21.0` (see `.node-version`). The package engine allows subsequent Node 24 patches.
- Bun `1.4.3` for dependency installation and package scripts.
- Docker with Docker Compose and permission to access the Docker daemon.
- OpenSSL and Chromium's system libraries for the HTTPS E2E suite.

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
bun x --bun playwright install --no-shell chromium
bun --no-env-file run test:e2e
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
metadata editing, lifecycle cancellation and rollback, concurrent writes, and the
partial unique reservation index. Booking tests cover timezone and time boundaries,
concurrent bookings, transaction retries and rollback, and races with lifecycle
operations. Reservation management tests cover ownership, list filters and phases,
archived history, cancellation cutoffs and concurrent cancellation, and React
booking/cancellation interactions. Fault tests cover strict text validation,
ownership, archived history, resolution audits and concurrency, safe text rendering,
and preservation of equipment and reservation state. Dashboard tests cover role
restrictions, empty data, metric counts, exact time boundaries, archive exclusion,
ranking and refresh, plus card links and loading/error states. Server suites run
sequentially to avoid competing MongoDB binary downloads on a fresh checkout.

`bun run build` produces `client/dist`. `bun run start` starts Express without
watch mode. In production, Express serves both the API and the SPA from one origin;
hashed assets are immutable for a year and HTML is revalidated. Unknown `/api/*`
paths and missing assets remain JSON 404s. Production startup requires a readable
client build. Secure session cookies require HTTPS.

The Chromium E2E suite starts its own production-mode HTTPS app on port `4310`,
temporary replica set and test-only accounts. Use `--no-env-file` to prevent Bun
from loading `.env`; the harness always supplies its own database and secrets. OpenSSL is
required for its temporary certificate. Test databases/certificates are removed
when the harness stops. Browser failures retain traces/screenshots in ignored test
output folders. First-run Chromium and MongoDB downloads require network access.
On Ubuntu, add `--with-deps` to the browser installation command to install system
libraries (as CI does). On Arch, use the system package manager for missing libraries.

## Structure and scope

- `client/src`: React authentication, equipment, reservation, fault report and admin dashboard pages, session context, route guards, and styles.
- `server/src/config`: environment validation.
- `server/src/db`: connection, local replica-set initialization, transaction check.
- `server/src/middleware`: validation, request IDs, security, limits, sessions, CSRF, errors.
- `server/src/routes`: versioned API router and health readiness.
- `server/src/shared`: safe logger, application errors, ObjectId validation.
- `server/src/app.js`: Express application factory.
- `server/src/server.js`: startup and graceful shutdown.
- `server/src/modules`: authentication, equipment, reservation, fault report and dashboard APIs, models, and DTOs.
- `server/test`: configuration, API middleware, authentication, and authorization tests.

All ten implementation increments are included. Follow
[deployment instructions](docs/DEPLOYMENT.md) to configure GitHub branch protection,
Atlas and Render, and verify the public HTTPS release. These account settings and
hosted verification must be completed separately from local checks. Use the
[demo rehearsal](docs/DEMO.md) for student/admin walkthroughs and the local fallback.

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
Students land on the available equipment catalog. Administrators land on the
dashboard at `/admin`, with links to equipment, reservation and fault management.

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
  text across name, asset code, category, and location. The `sort` parameter accepts
  `name_asc` (default), `name_desc`, or `newest`, selectable through the catalog's
  **Sort by** control. Name sorts use asset code ascending to break ties; newest
  uses creation time descending, then ID descending. Sorting happens before
  pagination and works with all filters. Archived equipment is always excluded;
  the API has no default status.
- `GET /api/v1/equipment/:id`: non-archived equipment or a JSON `404`.
- `POST /api/v1/equipment`: admin and CSRF required; strict metadata body
  `{ assetCode, name, category, location, description? }`. Creates available equipment
  and records the admin's status audit. Asset codes are trimmed, uppercased, and unique.
- `PATCH /api/v1/equipment/:id`: admin and CSRF required; at least one metadata field.
  Operational status, archive data, and internal fields are rejected.

Startup creates equipment indexes and the Reservation schema's indexes, including
the unique active `(equipmentId, startAt)` index. Cancelled reservations can share
a slot, so cancellation history does not prevent rebooking.

## Equipment lifecycle

Equipment implements the CRUD **Delete** operation through soft deletion, labelled
**Archive** in the UI. It removes equipment from the active catalog while retaining
linked reservation and fault history. Permanent deletion and restoration are not
supported.

Open an equipment detail page as an administrator to change its operational
status or archive it. Maintenance and unavailable states require a reason of
1–500 characters after trimming. Confirmation dialogs explain cancellation before
any mutation is sent; the form shows the number of reservations cancelled after
a successful status change and refetches the current equipment.

- `PATCH /api/v1/equipment/:id/status`: admin and CSRF required; strict body
  `{ status, reason? }`. Returns
  `{ data: { equipment, cancelledReservationCount } }`. Available equipment stores
  a null reason. Exact repeated status/reason requests leave audit data unchanged.
- `DELETE /api/v1/equipment/:id`: admin and CSRF required, no body needed. Soft
  archives the item and returns `204`. Repeating the archive of an existing item
  returns `204` without changing its original audit data. Unknown IDs return `404`.

Lifecycle writes increment the equipment's reservation guard within a MongoDB
transaction. Maintenance, unavailable, and archive operations cancel only active
reservations with `startAt > serverNow`, using the same connection and session.
The cancellation records the admin, timestamp, and matching equipment reason.
Started and historical slots, other equipment, and already-cancelled reservations
remain untouched. Returning equipment to available never restores cancellations.
Archive records its actor/timestamp, makes equipment unavailable, and preserves
the original documents and references for historical records.

If any write fails, the entire equipment-and-reservation transaction rolls back.
The transaction helper retries transient conflicts, obtaining fresh domain time
on each attempt. The booking engine writes the same equipment guard to coordinate
with lifecycle operations.

## Availability and booking

- `GET /api/v1/equipment/:id/availability`: authenticated read returning
  `{ data: { equipmentId, bookable, timezone, slotDurationMinutes, horizonDays, slots } }`.
  Each slot contains UTC ISO `startAt`/`endAt` and a display-only Colombo label.
  Maintenance/unavailable equipment returns `bookable: false` and no slots;
  archived or missing equipment returns `404`. Available equipment can have zero
  free slots while remaining operationally bookable.
- `POST /api/v1/reservations`: student and CSRF required; strict body
  `{ equipmentId, startAt }`. Use a returned slot's `startAt`. The server validates
  the request independently and returns `201` with a reservation DTO.

Bookings are one hour. Allowed starts are Monday–Friday at 08:30, 09:30, 10:30,
11:30, 12:30, 13:30, 14:30, and 15:30 in `Asia/Colombo`. A start must be strictly
after server time and at most 14 rolling days ahead. ISO strings must carry `Z`
or an explicit offset and represent an exact slot; invalid calendar dates, missing
offsets, and nonzero fractional seconds are rejected. Server time and schedule
rules cannot be supplied by the client.

Availability includes at most 80 legal starts before excluding elapsed and active
bookings. Cancelled reservations do not occupy a slot. Availability is advisory:
another student or a lifecycle operation may change the result before booking.

Reservation creation transactionally increments the equipment guard only if the
item is non-archived and available, then revalidates time and inserts a student-owned
record using the same connection/session. A failed insert or validation rolls back
the guard. Duplicate active slots return `409 RESERVATION_CONFLICT`; equipment that
is missing, archived, or out of service at the authoritative write returns
`409 EQUIPMENT_NOT_AVAILABLE`. Illegal times return `400 VALIDATION_ERROR`.

The reservation DTO derives `endAt` and temporal `phase` (`upcoming`, `inProgress`,
`past`); these are not stored.

## Reservation management

Students can book from an equipment detail page using only the slots returned by
the server. A successful booking refreshes availability and links to
`/reservations`. A conflict clears the stale selection and refreshes the slots;
booking again requires an explicit selection and submission.

- `GET /api/v1/reservations/mine`: student-only, returns the current student's
  reservations and omits redundant student details.
- `GET /api/v1/reservations`: admin-only, includes safe student name/email
  summaries and optional `equipmentId` and `studentId` filters.
- Both lists accept `view=upcoming|history|all` (default `upcoming`), `page`
  (default 1), and `limit` (default 12, maximum 50). Upcoming means active with
  `startAt > serverNow`, sorted ascending. History includes cancelled records or
  slots that have started, sorted descending. All sorts descending. Ties use ID
  for stable pagination. Lists retain archived equipment summaries.
- `PATCH /api/v1/reservations/:id/cancel`: student owner or admin, CSRF required,
  no body or an empty JSON object. An atomic conditional update cancels active
  slots only when `startAt > serverNow`, recording `student_cancelled` or
  `admin_cancelled` and the actor/time. Non-owned student IDs and missing IDs
  consistently return `404 RESOURCE_NOT_FOUND`. Started active slots return
  `409 RESERVATION_ALREADY_STARTED`. Repeated authorized cancellation returns the
  current cancelled DTO and preserves the original audit, including lifecycle
  cancellations. A cancelled slot can be rebooked.

Students use `/reservations`; admins use `/admin/reservations`. Both show
Upcoming, History and All views, pagination, cancellation confirmation and reasons,
and times explicitly in Asia/Colombo. Admins can narrow a list using a row's
equipment or student filter buttons. Use **Refresh reservations** to update phases
as time passes; the server rechecks the cutoff on every cancellation.

## Fault reporting and resolution

Students can select **Report a fault** on any current equipment detail page,
including maintenance or unavailable equipment. The form accepts text only and
shows the instruction to stop using suspected unsafe equipment and inform
laboratory staff; a web report does not replace physical safety procedures.
`/fault-reports/new` links to the full catalog when equipment has not been chosen.

- `POST /api/v1/fault-reports`: student and CSRF required. Strict body
  `{ equipmentId, category, title, description }`. Categories are `malfunction`,
  `damage`, `calibration`, `safety`, and `other`. Title is trimmed to 5–100
  characters; description is trimmed to 10–2000. Missing or archived equipment
  returns `404 RESOURCE_NOT_FOUND`. The reporter comes from the session.
- `GET /api/v1/fault-reports/mine`: student-only, restricted to the actor's reports.
- `GET /api/v1/fault-reports`: admin-only, with optional `equipmentId` and
  `reportedBy` filters. Both lists support optional `status=open|resolved`,
  `page` (default 1), and `limit` (default 12, maximum 50), sorted newest first
  with ID as a tie-breaker.
- `GET /api/v1/fault-reports/:id`: student owner or admin. Missing and non-owned
  student IDs consistently return `404 RESOURCE_NOT_FOUND`. DTOs include equipment
  and resolver summaries; admin responses also include a reporter summary. Password
  hashes and internal model fields are omitted. Archived equipment remains
  readable; missing legacy equipment references return a null equipment summary.
- `PATCH /api/v1/fault-reports/:id/resolve`: admin and CSRF required. Strict body
  `{ resolutionNote }`, trimmed to 5–1000 characters. An atomic conditional update
  records the note, admin and time once. Subsequent or concurrent losing attempts
  return `409 FAULT_ALREADY_RESOLVED`, preserving the winning audit. Reports cannot
  be reopened.

Students use `/fault-reports` for their report history. Admins use
`/admin/fault-reports` to filter reports, open their details and resolve them.
Existing reports remain resolvable after equipment archive. Report and resolution
text is rendered as plain text. Neither creation nor resolution changes equipment
status or reservations; admins use the separate equipment lifecycle controls for
those actions.

## Admin dashboard

`GET /api/v1/admin/dashboard` requires an administrator session and returns:

```json
{
  "data": {
    "equipment": {
      "total": 0,
      "byStatus": { "available": 0, "maintenance": 0, "unavailable": 0 }
    },
    "upcomingReservationCount": 0,
    "openFaultReportCount": 0,
    "topEquipment": []
  }
}
```

- Equipment totals and status counts exclude archived equipment.
- Upcoming reservations are active with `startAt > serverNow`; started, past and
  cancelled reservations are excluded.
- Open fault reports include every `open` report, including reports for archived
  equipment that still require staff review.
- Top 5 counts active (non-cancelled) reservation starts in
  `[serverNow - 30 days, serverNow)`, including in-progress slots. Only current
  non-archived equipment appears. Each entry contains `equipmentId`, `assetCode`,
  `name` and `reservationCount`, sorted by count descending, name ascending, then
  equipment ID for equal names. Unused equipment is omitted.

The dashboard at `/admin` displays metric cards linking to the corresponding
management filters and a simple Top 5 table. Usage measures reservations rather
than physical use. **Refresh dashboard** fetches current data; failures show an
error and retry instead of zero counts. Metrics are computed from the existing
indexed collections on every request, using one server time per request. There
are no client-supplied dates, charts, caches or background jobs.

## Seed sample data

With MongoDB running and the replica set initialized, run:

```sh
bun run db:seed-demo
```

This uses the database in your root `.env` and requires development/test mode.
Demo credentials are public, so use a development database. Production mode is
rejected before connecting. Existing admin bootstrap settings are not used.

The seed creates:

- 1 demo administrator and 2 demo students.
- 10 equipment items: 6 available, 2 maintenance, 1 unavailable and 1 archived.
- 36 reservations: 25 past, 6 upcoming and 5 cancelled, including lifecycle reasons.
- 7 faults: 5 open and 2 resolved, including an archived-equipment report.

| Role    | Email                        | Password                  |
| ------- | ---------------------------- | ------------------------- |
| Admin   | `demo.admin@example.test`    | `Lab demo password 2026!` |
| Student | `demo.student1@example.test` | `Lab demo password 2026!` |
| Student | `demo.student2@example.test` | `Lab demo password 2026!` |

Reservation dates are generated from the first seed run using legal Asia/Colombo
slots. Historical reservations populate Top 5 usage immediately. The entire
dataset is inserted in one transaction; collisions with existing demo emails or
`DEMO-*` asset codes abort without overwriting records. Rerunning an already-seeded
database skips the dataset, preserving edits, passwords and original dates. To
generate a fresh dated dataset later, use a fresh development database.

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
