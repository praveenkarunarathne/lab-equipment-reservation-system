# IMPLEMENTATION_SPEC.md

## 0. Document Status and Decision Provenance

**Project:** Engineering Laboratory Equipment Reservation and Maintenance Management System  
**Target module:** EE4207 – Web Application Development  
**Architecture status:** Frozen for v1 implementation  
**Specification date:** 2026-10-06  
**Decision source:** Confirmed decision log revision 19 (`decision-log-lab-equipment-system-v19.md`)

This specification is the implementation authority for v1. A coding agent should implement the system as written and should not substitute frameworks, libraries, data models, authentication mechanisms, state-management systems, deployment topology, or business rules without an explicit specification revision.

### 0.1 Requirement classification

- **Confirmed project requirements:** MERN stack; students can register/login, browse/search/filter equipment, reserve/manage reservations, and report faults; administrators can manage equipment, availability/maintenance status, reservations, faults, and basic usage information; RBAC, CRUD, form validation, reservation conflict detection, REST APIs, and database integration are required.
- **Confirmed user decisions:** self-contained local accounts; minimal register/login/logout lifecycle; single laboratory; immediate booking confirmation; fixed one-hour slots; pre-start cancellation; admin-reviewed fault reports; maintenance/unavailable automatically cancels future reservations; Monday–Friday 08:30–16:30 booking hours; 14-day booking horizon; text-only faults; simple dashboard; hosted Render + Atlas demo with local fallback.
- **Architectural decisions:** exact runtime/dependency versions, server-side sessions, Argon2id, synchronizer-token CSRF, modular monolith, data schema/indexes, transaction strategy, client state model, testing stack, local replica-set setup, Render/Atlas deployment, CI/CD, migrations, logging, and implementation order.
- **Assumptions:** v1 is a university-course capstone/demo rather than an institutionally integrated production system; the 08:30–16:30 schedule is a project rule and is not asserted to be an official University of Ruhuna lab policy; two roles are sufficient for v1.
- **Unresolved questions:** none blocking implementation. Known limitations and risks are listed in Section 49.

---

## 1. Project Overview and Objectives

Build a full-stack web application for one engineering laboratory. The application manages equipment catalog data, one-hour equipment reservations, fault reports, and administrator maintenance state. It must demonstrate the complete MERN request path clearly enough for a viva: React UI → REST request → Express route/middleware → controller → service → Mongoose model → MongoDB.

Primary objectives:

1. Provide secure local student registration, login, logout, and role-based access control.
2. Let authenticated students browse current equipment, search/filter it, inspect availability, reserve legal one-hour slots, view reservation history, cancel future reservations, and submit text-only fault reports.
3. Let administrators create/update/archive equipment, change operational status, monitor/cancel reservations, review/resolve fault reports, and view compact usage metrics.
4. Correctly prevent conflicting reservations, including concurrent requests.
5. Ensure setting equipment to `maintenance` or `unavailable`, or archiving it, atomically cancels all future active reservations.
6. Preserve historical reservations and fault reports even after equipment is archived.
7. Remain simple enough that a student can explain and rewrite major code paths during evaluation.

---

## 2. Scope and Non-Goals

### 2.1 In scope

- Two roles: `student`, `admin`.
- Public student registration; login/logout; authenticated session persistence.
- Equipment CRUD for administrators, implemented as create/update/status-change/soft-archive.
- Equipment browse/search/filter for authenticated users.
- Fixed one-hour reservations.
- Server-side schedule validation in `Asia/Colombo`.
- 14-day rolling booking horizon.
- Reservation conflict prevention using a MongoDB unique partial index plus transaction-aware service logic.
- Student and administrator reservation views and cancellation.
- Text-only fault reports; administrator resolution workflow.
- Administrator dashboard with summary counts and Top 5 equipment table.
- REST API under `/api/v1`.
- Local MongoDB replica-set development environment.
- Hosted Render Web Service + MongoDB Atlas deployment.
- Automated unit, integration, component, and E2E tests.
- GitHub Actions CI.

### 2.2 Explicit non-goals for v1

Do not implement:

- University SSO/OIDC/LDAP.
- Email verification, password reset, password change, outbound email, SMS, or push notifications.
- More than one laboratory or a `Lab` entity.
- Administrator approval of reservation requests.
- Flexible reservation durations.
- Recurring reservations.
- Waitlists.
- File/image uploads.
- Separate maintenance work orders or maintenance history collection.
- Equipment restore/unarchive UI.
- User/role administration UI.
- Charts or advanced analytics.
- Redis, queues, cron jobs, workers, event buses, microservices, or WebSockets.
- GraphQL.
- Mobile/native clients.
- Offline operation.
- Payment, billing, fines, or penalties.
- Persistent files on Render.
- Generic plugin architecture or repository/base-service abstraction.

---

## 3. Functional Requirements

### 3.1 Student requirements

An unauthenticated visitor can register a student account and log in. Registration always creates `role=student`; any client-supplied role field must be rejected or ignored by allowlisted validation and must never reach persistence.

An authenticated student can:

- Browse non-archived equipment.
- Search equipment by name, asset code, category, or location.
- Filter by category and status.
- View equipment details and current operational status.
- View server-generated legal availability for a selected equipment item.
- Reserve one available future slot that satisfies all schedule/horizon rules.
- View own upcoming and historical reservations.
- Cancel own reservation strictly before the slot begins.
- Submit a fault report for non-archived equipment.
- View own fault reports and resolution state.

### 3.2 Administrator requirements

An authenticated admin can:

- Perform all authenticated read operations.
- Create equipment.
- Edit equipment metadata.
- Change equipment status among `available`, `maintenance`, and `unavailable`.
- Archive equipment.
- View all reservations.
- Cancel any future active reservation.
- View all fault reports and individual reports.
- Resolve an open fault report with a resolution note.
- View dashboard counts and Top 5 equipment usage.

### 3.3 Reservation business rules

- Reservations are confirmed immediately; there is no approval state.
- Each reservation occupies exactly one hour.
- Business timezone is `Asia/Colombo`.
- Legal weekdays: Monday through Friday only.
- Legal local start times: `08:30`, `09:30`, `10:30`, `11:30`, `12:30`, `13:30`, `14:30`, `15:30`.
- A slot must be strictly in the future according to server time.
- A slot must be no more than 14 days ahead of server time.
- Only non-archived equipment with `status=available` can be booked.
- One active reservation per `{equipmentId, startAt}` is allowed.
- Cancelled reservations do not block the slot.
- Student cancellation is allowed only for the student's own active reservation when `startAt > now`.
- Admin cancellation is allowed for any active future reservation.
- Reservation temporal phase (`upcoming`, `inProgress`, `past`) is derived from `startAt`, one-hour duration, and current time; it is not stored.

### 3.4 Maintenance rules

- Students cannot change equipment status.
- Creating a fault report does not change equipment status.
- Changing equipment to `maintenance` or `unavailable` atomically cancels every future active reservation for that equipment.
- Archiving equipment also atomically cancels every future active reservation and makes the item unavailable for normal catalog/API operations.
- Returning equipment to `available` does not restore cancelled reservations.
- A status change does not cancel a reservation whose slot has already started; physical stop-use procedures are outside this application.

---

## 4. Non-Functional Requirements

### 4.1 Security

- Authentication and authorization are server-authoritative.
- Passwords are never stored or logged in plaintext.
- Browser auth state uses an opaque server-side session, not JWTs in browser storage.
- Unsafe requests use CSRF protection.
- Public registration cannot assign privileged fields.
- Validation occurs server-side for every boundary input.
- Error responses do not expose stack traces or secrets.
- Logs redact credentials/session/CSRF material.

### 4.2 Correctness

- Concurrent same-slot requests must yield exactly one successful booking.
- Booking and equipment-maintenance races must preserve the invariant that out-of-service equipment has no future active reservations after the maintenance/archive transaction commits.
- Multi-document invariants must run on transaction-capable MongoDB.

### 4.3 Performance targets

These are design targets for a capstone workload, not contractual SLAs:

- Normal API reads should be comfortably sub-second on warm local/hosted environments for hundreds of equipment records and tens of thousands of reservations.
- List endpoints are paginated and capped at 50 records per response.
- Availability generation is bounded to at most 80 legal weekday starts in a rolling 14-day interval before elapsed/booked filtering.
- No unbounded collection scans should be introduced for normal list/reservation/fault queries where an index is defined.
- Search uses case-insensitive regex and is intentionally accepted as a small-dataset tradeoff; revisit only if equipment count grows materially.

### 4.4 Maintainability and viva-readability

- Prefer explicit functions/modules over framework magic.
- Controllers remain thin.
- Business logic belongs in services.
- No generic repository or base-service framework.
- No unnecessary frontend data/state libraries.
- Important business constants are named and centralized.

---

## 5. System Architecture

Use a **modular monolith** with one deployable Node/Express process and one React SPA.

Logical flow:

`Browser React SPA -> /api/v1 -> Express middleware -> route -> controller -> service -> Mongoose -> MongoDB`

Production topology:

`Browser -> HTTPS Render Web Service -> Express API + React static assets -> MongoDB Atlas`

Development topology:

`Browser -> Vite :5173 -> /api proxy -> Express :3000 -> local MongoDB 8.0 replica set :27017`

No separate API host, frontend host, Redis, worker, or object store is used.

---

## 6. Major Components and Responsibilities

| Component | Responsibilities | Must not own |
| --- | --- | --- |
| React SPA | Routing, forms, rendering, loading/error states, role-aware navigation, calling REST API | Authorization, reservation legality, conflict decisions |
| API client | Relative `/api/v1` requests, JSON parsing, CSRF header injection, normalized API errors | Domain rules |
| Express app | Middleware composition, routes, static SPA serving | Domain transactions |
| Auth middleware | Session presence and role checks | Business resource ownership beyond simple role gates |
| Controllers | Translate HTTP input/output and call services | Database queries or domain rules |
| Services | Business rules, ownership checks, transactions, conflict/status logic | Express `req`/`res` objects |
| Zod validation | Request body/query/param allowlists and normalization | Database persistence |
| Mongoose models | Schema, types, indexes, persistence | HTTP behavior |
| MongoDB | Durable domain/session data, indexes, transaction isolation | UI/business policy selection |
| Dashboard service | Aggregate existing collections | Separate analytics storage/cache |

---

## 7. Technology Stack

### 7.1 Runtime and package management

| Item | Exact version / decision |
| --- | --- |
| Language | JavaScript ESM + JSX; no TypeScript in v1 |
| Node.js | `24.21.0` LTS |
| npm | `11.19.0` |
| MongoDB server baseline | `8.0`; local/test image/binary `8.0.32` |
| Package structure | npm workspaces: `client`, `server` |
| Locking | committed root `package-lock.json`; exact dependency versions |

### 7.2 Frontend

| Dependency | Version | Purpose |
| --- | ---: | --- |
| `react` | 19.3.0 | UI component model |
| `react-dom` | 19.3.0 | Browser rendering |
| `react-router` | 8.3.1 | Declarative SPA routing and navigation |
| `vite` | 8.3.3 | Dev server and production build |
| `@vitejs/plugin-react` | 6.1.2 | React JSX/Fast Refresh integration |

Do not install Axios, Redux, Zustand, TanStack Query, React Hook Form, Tailwind, Bootstrap, Material UI, or a charting library.

### 7.3 Backend

| Dependency | Version | Purpose |
| --- | ---: | --- |
| `express` | 5.2.1 | HTTP REST server and middleware |
| `mongoose` | 9.11.0 | MongoDB ODM, schemas, indexes, transactions |
| `mongodb` | 7.7.0 | Direct driver types/errors/utilities when needed; do not bypass Mongoose for normal domain CRUD |
| `zod` | 4.6.5 | Request/query/param validation and normalization |
| `express-session` | 1.19.0 | Opaque cookie session middleware |
| `connect-mongo` | 6.0.0 | MongoDB-backed session store |
| `argon2` | 0.45.1 | Argon2id password hashing |
| `helmet` | 8.3.0 | HTTP security headers/CSP |
| `express-rate-limit` | 8.7.0 | Auth and general IP-based throttling |
| `pino` | 10.3.1 | Structured JSON logging |
| `pino-http` | 11.0.0 | HTTP request logging |
| `date-fns` | 4.4.0 | Date arithmetic/format helpers |
| `@date-fns/tz` | 1.5.0 | Named-timezone calculations for `Asia/Colombo` |

### 7.4 Test and quality dependencies

| Dependency | Version | Purpose |
| --- | ---: | --- |
| `vitest` | 5.0.3 | Unit/integration/component test runner |
| `supertest` | 7.3.1 | Express HTTP integration tests |
| `mongodb-memory-server` | 11.3.0 | Real temporary replica set for tests |
| `jsdom` | 30.0.1 | Browser-like component test environment |
| `@testing-library/react` | 16.3.3 | React behavior tests |
| `@testing-library/user-event` | 14.6.7 | User interaction simulation |
| `@testing-library/jest-dom` | 7.0.1 | DOM assertions |
| `@playwright/test` | 1.63.0 | Chromium end-to-end tests |
| `eslint` | 10.10.0 | Static linting |
| `@eslint/js` | 10.0.1 | ESLint JS rules |
| `eslint-plugin-react-hooks` | 7.1.1 | React Hooks rules |
| `eslint-plugin-react-refresh` | 0.5.7 | Vite/React refresh safety |
| `globals` | 17.12.0 | Environment globals definitions |
| `prettier` | 3.9.9 | Formatting |

---

## 8. Exact Runtime and Compatibility Policy

- `.node-version` must contain exactly `24.21.0`.
- Root `package.json` should constrain Node to the selected 24.x baseline rather than use an unbounded `>=` range.
- Add root `.npmrc` with `save-exact=true` so new packages are exact-pinned.
- Commit `package-lock.json` and use `npm ci` in CI and Render.
- Server source is native ESM (`"type": "module"`); do not transpile Node source.
- Dependency upgrades are separate maintenance work. Do not silently replace a version because a newer release exists.

---

## 9. Project/Folder/Module Structure

Use this structure as the default file plan:

```text
/
  package.json
  package-lock.json
  .npmrc
  .node-version
  .gitignore
  .env.example
  docker-compose.yml
  README.md
  IMPLEMENTATION_SPEC.md
  decision-log-lab-equipment-system-v19.md
  .github/
    workflows/
      ci.yml
  client/
    package.json
    index.html
    vite.config.js
    src/
      main.jsx
      App.jsx
      api/
        apiClient.js
      auth/
        AuthContext.jsx
        ProtectedRoute.jsx
        AdminRoute.jsx
      components/
        AppLayout.jsx
        Navigation.jsx
        LoadingState.jsx
        ErrorMessage.jsx
        Pagination.jsx
        StatusBadge.jsx
        ConfirmDialog.jsx
      pages/
        LoginPage.jsx
        RegisterPage.jsx
        EquipmentListPage.jsx
        EquipmentDetailPage.jsx
        ReservationsPage.jsx
        FaultReportsPage.jsx
        FaultReportNewPage.jsx
        admin/
          AdminDashboardPage.jsx
          AdminEquipmentPage.jsx
          AdminEquipmentFormPage.jsx
          AdminReservationsPage.jsx
          AdminFaultReportsPage.jsx
      routes/
        AppRoutes.jsx
      styles/
        base.css
        layout.css
        components.css
        pages.css
      utils/
        formatDateTime.js
        formValidation.js
  server/
    package.json
    src/
      server.js
      app.js
      config/
        env.js
        constants.js
      db/
        connect.js
        ensureCriticalIndexes.js
        initReplicaSet.js
        seedAdmin.js
        migrate.js
        migrations/
      middleware/
        auth.js
        csrf.js
        errorHandler.js
        notFound.js
        rateLimits.js
        requestId.js
        security.js
        validate.js
      shared/
        AppError.js
        asyncTransaction.js
        clock.js
        dto.js
        logger.js
        objectId.js
        pagination.js
      modules/
        auth/
          auth.validation.js
          auth.service.js
          auth.controller.js
          auth.routes.js
        users/
          user.model.js
          user.dto.js
        equipment/
          equipment.model.js
          equipment.validation.js
          equipment.service.js
          equipment.controller.js
          equipment.routes.js
          equipment.dto.js
        reservations/
          reservation.model.js
          reservation.validation.js
          reservationTime.js
          reservation.service.js
          reservation.controller.js
          reservation.routes.js
          reservation.dto.js
        faultReports/
          faultReport.model.js
          faultReport.validation.js
          faultReport.service.js
          faultReport.controller.js
          faultReport.routes.js
          faultReport.dto.js
        dashboard/
          dashboard.service.js
          dashboard.controller.js
          dashboard.routes.js
      routes/
        apiRouter.js
      static/
        serveSpa.js
    test/
      unit/
      integration/
      fixtures/
      helpers/
  e2e/
    playwright.config.js
    tests/
```

The exact number of small presentation components may vary, but module boundaries must not.

---

## 10. Module Boundaries and Ownership

### 10.1 Rules

- Routes declare paths, middleware, and controller functions only.
- Controllers read validated values already attached by validation middleware, call one service operation, and construct the HTTP response.
- Services perform business authorization/ownership checks, persistence calls, transaction orchestration, and domain errors.
- Models define schemas and indexes only. Do not embed request/response concerns in model hooks.
- Zod schemas allowlist client-controlled properties; never spread `req.body` into a Mongoose update.
- Services receive primitive/domain arguments and actor context, never Express request/response objects.
- Cross-module service calls are allowed only when a domain operation genuinely spans modules; controllers never call another controller.
- Do not add a generic repository, generic CRUD service, event bus, or dependency-injection framework.

### 10.2 Actor context

After authentication middleware, service calls receive an actor object equivalent to `{ userId, role }` derived from the server session. Client-provided ownership/user IDs never replace this actor identity.

---

## 11. Data Flow Between Components

### 11.1 Login flow

1. SPA obtains a CSRF token from `GET /api/v1/auth/csrf`.
2. Login form sends email/password plus `X-CSRF-Token`.
3. Auth middleware validates CSRF/fetch metadata/origin.
4. Controller passes normalized credentials to auth service.
5. Service selects user including `passwordHash`, verifies Argon2id, regenerates the session ID, creates a fresh CSRF token, stores `{userId, role, csrfToken}` in the session, and returns a sanitized user DTO.
6. Response returns user and the rotated CSRF token; browser receives the session cookie.
7. Auth context stores only sanitized user and CSRF token in memory. No token/session ID is written to localStorage/sessionStorage.

### 11.2 Reservation flow

1. Equipment detail loads server-generated availability.
2. Student selects a returned `startAt` and submits `{equipmentId,startAt}`.
3. Server revalidates all time rules using server time; availability display is never trusted as authorization.
4. Reservation service opens a transaction.
5. It conditionally writes the selected equipment document only if non-archived and `available`, incrementing `reservationGuardVersion`.
6. It inserts the active reservation.
7. Duplicate active slot becomes `409 RESERVATION_CONFLICT`.
8. Transaction commits; response is `201`.

### 11.3 Maintenance flow

1. Admin submits status change.
2. Service opens a transaction.
3. Equipment document is updated and `reservationGuardVersion` incremented.
4. If target status is `maintenance` or `unavailable`, future active reservations are changed to `cancelled` with the corresponding cancellation reason.
5. Transaction commits atomically.

---

## 12. Database/Storage Architecture

Use one MongoDB database, default local database name `lab_equipment`.

Collections:

- `users`
- `equipment`
- `reservations`
- `faultreports`
- `sessions` (owned by `connect-mongo`)
- `schema_migrations` (operational metadata)

Do not create collections for labs, maintenance work orders, uploads, notifications, analytics, or reservation completion.

Use ObjectId references rather than embedding changing user/equipment objects. Historical API responses may populate selected referenced fields. Equipment is never hard-deleted in v1.

Mongoose conventions:

- `timestamps: true` on all domain schemas.
- Keep Mongoose persistence documents internal; API DTOs explicitly map `_id` to `id` and omit internal fields.
- `passwordHash` uses `select:false`.
- Do not expose `reservationGuardVersion`, `__v`, session documents, or database metadata through API DTOs.
- Prefer explicit `lean()` + projection on read-only list/aggregation support queries where document methods are unnecessary.

---

## 13. Database Schema, Relationships, Indexes, and Constraints

### 13.1 `users`

| Field | Type | Rules |
| --- | --- | --- |
| `_id` | ObjectId | MongoDB generated |
| `name` | String | trim; 2–80 chars |
| `email` | String | trim + lowercase; valid email; max 254; unique |
| `passwordHash` | String | required; `select:false`; Argon2id encoded string |
| `role` | String enum | `student` or `admin`; default `student` |
| `createdAt`, `updatedAt` | Date | timestamps |

Index:

- unique `{ email: 1 }`, name `uq_users_email`.

Relationships:

- User 1→N reservations via `Reservation.studentId`.
- User 1→N reported faults via `FaultReport.reportedBy`.
- Admin users can appear in equipment status/archive and reservation/fault resolution audit references.

### 13.2 `equipment`

| Field | Type | Rules |
| --- | --- | --- |
| `_id` | ObjectId | generated |
| `assetCode` | String | trim, uppercase; 2–30; regex `^[A-Z0-9][A-Z0-9_-]*$`; unique |
| `name` | String | trim; 2–100 |
| `category` | String | trim; 2–50 |
| `location` | String | trim; 2–100 |
| `description` | String | trim; max 1000; default `""` |
| `status` | enum | `available`, `maintenance`, `unavailable`; default `available` |
| `statusReason` | String/null | null when available; required non-empty for maintenance/unavailable; max 500 |
| `statusUpdatedAt` | Date | initialize on create; update on status change |
| `statusUpdatedBy` | ObjectId→User | admin responsible for current status |
| `reservationGuardVersion` | Integer | internal; default 0; increment on booking/status/archive transaction writes |
| `archivedAt` | Date/null | null unless archived |
| `archivedBy` | ObjectId→User/null | admin who archived |
| `createdAt`, `updatedAt` | Date | timestamps |

Indexes:

- unique `{ assetCode: 1 }`, name `uq_equipment_asset_code`.
- `{ archivedAt: 1, status: 1, category: 1 }`, name `idx_equipment_catalog`.

Archived equipment is excluded from normal catalog and admin equipment lists. Historical reservation/fault DTOs may still resolve it.

### 13.3 `reservations`

| Field | Type | Rules |
| --- | --- | --- |
| `_id` | ObjectId | generated |
| `studentId` | ObjectId→User | required; student actor |
| `equipmentId` | ObjectId→Equipment | required |
| `startAt` | Date | required UTC instant; must satisfy schedule/horizon on create |
| `status` | enum | `active` or `cancelled`; default `active` |
| `cancelledAt` | Date/null | set on cancellation |
| `cancelledBy` | ObjectId→User/null | actor who cancelled |
| `cancellationReason` | enum/null | `student_cancelled`, `admin_cancelled`, `equipment_maintenance`, `equipment_unavailable`, `equipment_archived` |
| `createdAt`, `updatedAt` | Date | timestamps |

Do not store `endAt`, `phase`, `completed`, or approval fields. `endAt = startAt + 60 minutes`; temporal phase is derived.

Indexes:

- unique partial `{ equipmentId: 1, startAt: 1 }` with `partialFilterExpression: { status: "active" }`, name `uq_reservation_active_equipment_start`.
- `{ studentId: 1, startAt: -1 }`, name `idx_reservations_student_start`.
- `{ status: 1, startAt: 1 }`, name `idx_reservations_status_start`.

### 13.4 `faultreports`

| Field | Type | Rules |
| --- | --- | --- |
| `_id` | ObjectId | generated |
| `equipmentId` | ObjectId→Equipment | required; equipment must be non-archived at creation |
| `reportedBy` | ObjectId→User | required; student actor |
| `category` | enum | `malfunction`, `damage`, `calibration`, `safety`, `other` |
| `title` | String | trim; 5–100 |
| `description` | String | trim; 10–2000 |
| `status` | enum | `open` or `resolved`; default `open` |
| `resolutionNote` | String/null | required on resolution; 5–1000 |
| `resolvedAt` | Date/null | set once |
| `resolvedBy` | ObjectId→User/null | resolving admin |
| `createdAt`, `updatedAt` | Date | timestamps |

Indexes:

- `{ status: 1, createdAt: -1 }`, `idx_fault_status_created`.
- `{ reportedBy: 1, createdAt: -1 }`, `idx_fault_reporter_created`.
- `{ equipmentId: 1, createdAt: -1 }`, `idx_fault_equipment_created`.

Resolved faults cannot be reopened in v1.

### 13.5 `schema_migrations`

Minimum fields: migration ID string, applied timestamp. Migration ID is unique. This collection is written only by the migration runner.

---

## 14. API Architecture

- Base prefix: `/api/v1`.
- REST + JSON only.
- `express.json({ limit: '16kb' })`.
- No CORS middleware; production is same-origin and development uses Vite proxy.
- IDs in URL/body must be 24-hex ObjectId strings before service execution.
- Unsafe body routes accept `application/json`; reject unsupported body media type with `415`.
- All list endpoints use bounded pagination where applicable.
- Successful single-resource envelope: `{ "data": ... }`.
- Successful list envelope: `{ "data": [...], "pagination": { "page", "limit", "total", "totalPages" } }`.
- Error envelope: `{ "error": { "code", "message", "fieldErrors"?, "requestId" } }`.
- Unknown `/api/*` routes always return JSON `404`; SPA fallback must never intercept them.

### 14.1 HTTP status policy

- `200`: successful read/update/idempotent cancellation/no-op state update.
- `201`: successful registration/equipment creation/reservation/fault creation.
- `204`: logout success and equipment archive success, including repeated archive of the same existing archived ID.
- `400`: malformed/semantic validation.
- `401`: no valid auth session; login credential failure also uses 401 with generic message.
- `403`: authenticated but insufficient role/ownership, or invalid CSRF.
- `404`: missing or intentionally hidden resource.
- `409`: duplicate/state/business conflict.
- `415`: unsupported content type.
- `429`: rate limit.
- `503`: health endpoint cannot reach MongoDB.
- `500`: unexpected server error.

---

## 15. API Endpoints and Contracts

### 15.1 Health

#### `GET /api/v1/health`

Auth: none. CSRF: none.

Success `200`:

`{ data: { status: "ok", database: "ok" } }`

Database readiness must use a bounded ping. If unavailable, return `503` with stable error code `SERVICE_UNAVAILABLE`. Do not expose dependency versions, URIs, credentials, hostnames, or stack details.

### 15.2 Authentication

#### `GET /api/v1/auth/csrf`

Auth: none. Creates/uses a pre-auth session because `saveUninitialized=false` otherwise would not set a session cookie.

Response `200`:

`{ data: { csrfToken: "<opaque-random-token>" } }`

#### `POST /api/v1/auth/register`

Auth: none. CSRF required.

Request:

`{ name, email, password }`

Behavior:

- Allowlist only these three properties.
- Normalize name/email; do not normalize or trim password.
- Role is always `student`.
- Hash password with selected Argon2id parameters.
- Registration does not log the user in.

Response `201`:

`{ data: { user: { id, name, email, role: "student", createdAt } } }`

Duplicate email: `409 EMAIL_ALREADY_REGISTERED`.

#### `POST /api/v1/auth/login`

Auth: none. CSRF required.

Request: `{ email, password }`.

Behavior:

- Generic failure response for unknown email or bad password.
- On success regenerate session ID before storing authenticated session state.
- Generate a new CSRF token after regeneration.

Response `200`:

`{ data: { user: { id, name, email, role }, csrfToken } }`

Failure: `401 INVALID_CREDENTIALS` with no account-existence disclosure.

#### `POST /api/v1/auth/logout`

Auth: authenticated. CSRF required. No request body required.

Behavior: destroy server session and clear session cookie.

Response: `204`.

#### `GET /api/v1/auth/me`

Auth: authenticated.

Response `200`: `{ data: { user: { id, name, email, role } } }`.

No profile-edit, password-change, password-reset, or account-delete endpoint exists in v1.

### 15.3 Equipment

All equipment reads require authentication.

#### `GET /api/v1/equipment`

Query:

- `page` integer default 1.
- `limit` integer default 12, max 50.
- `q` optional trimmed string max 80; escaped before case-insensitive regex search across name/assetCode/category/location.
- `category` optional max 50; exact case-insensitive match.
- `status` optional enum `available|maintenance|unavailable`.

Always exclude archived items. Sort by name ascending, then assetCode ascending.

Student UI defaults to `status=available`; API itself may return any current status when explicitly requested so status can be inspected and faults can be reported.

Equipment DTO:

`{ id, assetCode, name, category, location, description, status, statusReason, statusUpdatedAt, createdAt, updatedAt }`

#### `GET /api/v1/equipment/:id`

Auth: authenticated. Return non-archived equipment or `404 RESOURCE_NOT_FOUND`.

#### `GET /api/v1/equipment/:id/availability`

Auth: authenticated.

Response:

`{ data: { equipmentId, bookable, timezone: "Asia/Colombo", slotDurationMinutes: 60, horizonDays: 14, slots: [{ startAt, endAt, label }] } }`

Rules:

- At most 80 legal starts exist within a rolling 14-day interval before elapsed/booked filtering.
- `startAt`/`endAt` are ISO UTC strings and are the machine-readable authority.
- `label` is display-only, formatted in `Asia/Colombo`.
- If equipment is maintenance/unavailable, `bookable=false` and `slots=[]`.
- Availability is advisory; reservation creation revalidates everything.

#### `POST /api/v1/equipment`

Auth: admin. CSRF required.

Request allowlist:

`{ assetCode, name, category, location, description? }`

Created equipment starts `available`. Do not accept `status`, archive fields, status audit fields, or guard version from client.

Response `201`: `{ data: <EquipmentDTO> }`. Duplicate asset code: `409 ASSET_CODE_ALREADY_EXISTS`.

#### `PATCH /api/v1/equipment/:id`

Auth: admin. CSRF required.

Allowlist only metadata fields: `assetCode`, `name`, `category`, `location`, `description`. At least one field required. Status changes must use the dedicated status endpoint.

Response `200`: `{ data: <EquipmentDTO> }`.

#### `PATCH /api/v1/equipment/:id/status`

Auth: admin. CSRF required.

Request: `{ status, reason? }`.

Rules:

- `status` required and must be allowed enum.
- `reason` required, trimmed, non-empty, max 500 for `maintenance` or `unavailable`.
- For `available`, persist `statusReason=null`.
- Transition to maintenance/unavailable runs transaction and cancels all future active reservations with reason matching target state.
- Same status + same normalized reason may return current resource with `200` as a no-op.
- Same status + changed reason may update status audit/reason without re-cancelling already cancelled reservations.

Response `200`: `{ data: { equipment: <EquipmentDTO>, cancelledReservationCount: <integer> } }`. Return `0` when no future reservation was cancelled.

#### `DELETE /api/v1/equipment/:id`

Auth: admin. CSRF required.

Behavior:

- Soft archive only.
- Transactionally set archived fields, out-of-service state, increment guard version, and cancel future active reservations with `equipment_archived`.
- Do not delete history.
- Repeating the archive for an already archived existing ID returns `204`.

Response: `204`.

### 15.4 Reservations

#### `POST /api/v1/reservations`

Auth: student. CSRF required.

Request: `{ equipmentId, startAt }`.

`startAt` must be a parseable ISO timestamp representing one legal server-defined slot. The server must independently enforce timezone/day/time/future/horizon rules.

Response `201`: `{ data: <ReservationDTO> }`.

Known conflicts:

- `409 EQUIPMENT_NOT_AVAILABLE` when equipment is archived/out-of-service at authoritative write point.
- `409 RESERVATION_CONFLICT` when active slot uniqueness loses a concurrent race.
- `400 VALIDATION_ERROR` for illegal time/weekend/horizon.

Reservation DTO:

`{ id, status, startAt, endAt, phase, cancellationReason, cancelledAt, equipment: { id, assetCode, name, location, status, archived }, student? }`

For student-own endpoints omit redundant `student`; admin list includes `{ id, name, email }`.

#### `GET /api/v1/reservations/mine`

Auth: student.

Query:

- `view=upcoming|history|all`, default `upcoming`.
- `page`, `limit` as standard pagination.

Definitions:

- upcoming: active and `startAt > now`, sorted ascending.
- history: cancelled or `startAt <= now`, sorted `startAt` descending.
- all: all own records, sorted `startAt` descending.

#### `GET /api/v1/reservations`

Auth: admin.

Query:

- `view=upcoming|history|all`, default `upcoming`.
- optional `equipmentId`.
- optional `studentId`.
- `page`, `limit`.

Return populated student/equipment summary fields.

#### `PATCH /api/v1/reservations/:id/cancel`

Auth: authenticated student owner or admin. CSRF required.

No client cancellation reason is accepted.

Rules:

- Student owner before start → `student_cancelled`.
- Admin before start → `admin_cancelled`.
- Unauthorized access → `403` or intentionally hidden `404` according to service policy; use one consistent policy in tests. Prefer `404` for non-owned student resource IDs to reduce object enumeration.
- Already-cancelled authorized call → `200` with `{ data: <ReservationDTO> }` for the current cancelled record.
- Active reservation that has started/passed → `409 RESERVATION_ALREADY_STARTED` or `RESERVATION_NOT_CANCELLABLE` according to condition; use `RESERVATION_ALREADY_STARTED` when time is the reason.

### 15.5 Fault reports

#### `POST /api/v1/fault-reports`

Auth: student. CSRF required.

Request: `{ equipmentId, category, title, description }`.

Equipment must exist and be non-archived. Do not mutate equipment status.

Response `201`: `{ data: <FaultReportDTO> }`.

The corresponding UI must show safety copy: suspected unsafe equipment should not be used and laboratory staff should be informed; the web report is not a physical safety procedure.

#### `GET /api/v1/fault-reports/mine`

Auth: student. Query: optional `status=open|resolved`, pagination. Sort newest first.

#### `GET /api/v1/fault-reports`

Auth: admin. Query: optional `status`, optional `equipmentId`, optional `reportedBy`, pagination. Sort newest first.

#### `GET /api/v1/fault-reports/:id`

Auth: owner student or admin. Return nested equipment summary and reporter/resolver summary as applicable.

#### `PATCH /api/v1/fault-reports/:id/resolve`

Auth: admin. CSRF required.

Request: `{ resolutionNote }`, trimmed 5–1000.

Rules:

- Set `status=resolved`, `resolvedAt=serverNow`, `resolvedBy=adminId`.
- Do not change equipment status.
- Resolved reports cannot reopen.
- Re-resolve → `409 FAULT_ALREADY_RESOLVED`.

### 15.6 Dashboard

#### `GET /api/v1/admin/dashboard`

Auth: admin.

Response shape:

```text
{
  data: {
    equipment: {
      total,
      byStatus: { available, maintenance, unavailable }
    },
    upcomingReservationCount,
    openFaultReportCount,
    topEquipment: [
      { equipmentId, assetCode, name, reservationCount }
    ]
  }
}
```

Metric semantics:

- Equipment counts exclude archived equipment.
- Upcoming reservations = `status=active` and `startAt > serverNow`.
- Open faults = `status=open`.
- Top 5 uses current non-archived equipment only and counts non-cancelled reservation starts in `[serverNow - 30 days, serverNow)`.
- Sort Top 5 by count descending, then equipment name ascending.
- No charts, cache, background aggregation, or analytics collection.

---

## 16. Stable Error Codes

Required codes:

- `VALIDATION_ERROR`
- `AUTH_REQUIRED`
- `INVALID_CREDENTIALS`
- `FORBIDDEN`
- `CSRF_INVALID`
- `RESOURCE_NOT_FOUND`
- `EMAIL_ALREADY_REGISTERED`
- `ASSET_CODE_ALREADY_EXISTS`
- `EQUIPMENT_NOT_AVAILABLE`
- `RESERVATION_CONFLICT`
- `RESERVATION_ALREADY_STARTED`
- `RESERVATION_NOT_CANCELLABLE`
- `FAULT_ALREADY_RESOLVED`
- `RATE_LIMITED`
- `UNSUPPORTED_MEDIA_TYPE`
- `SERVICE_UNAVAILABLE`
- `INTERNAL_ERROR`

`message` is human-readable but clients should branch on `code`, not message text. Validation failures may include `fieldErrors` keyed by request field.

---

## 17. Internal Interfaces/Contracts

### 17.1 Service return policy

Services return domain results/DTO-ready plain values and throw typed `AppError` instances for expected failures. They must not return Express responses.

### 17.2 Transaction contract

Create one shared transaction helper that executes a sequential callback via Mongoose `Connection#transaction()` or `session.withTransaction()`. Do not execute transaction operations with `Promise.all()`.

Reservation and maintenance services must receive/use the same Mongoose connection and session for every persistence call participating in a transaction.

### 17.3 Clock contract

Centralize current-time access in `server/src/shared/clock.js`. Time-sensitive services and helpers obtain `serverNow` from this wrapper so unit tests can freeze or stub time consistently. Never accept “current time” from the client.

### 17.4 DTO contract

Use explicit DTO mapper functions per domain. DTO mapping is responsible for:

- `_id` → `id`.
- Date → ISO string.
- Deriving reservation `endAt` and `phase`.
- Nested minimal user/equipment summaries.
- Omitting internal/security fields.

---

## 18. Authentication and Authorization Design

### 18.1 Session model

Use `express-session` with `connect-mongo`.

Session domain data contains only:

- `userId`
- `role`
- `csrfToken`

Express-session may store its own cookie/session metadata in the session document.

Session settings:

- `resave: false`
- `saveUninitialized: false`
- max age: 8 hours
- `rolling: false`
- Mongo store TTL: 8 hours
- `touchAfter: 3600` seconds

Production cookie:

- name: `__Host-lab.sid`
- `Path=/`
- no `Domain`
- `HttpOnly=true`
- `Secure=true`
- `SameSite=Lax`

Development cookie:

- name: `lab.sid`
- same other semantics except `Secure=false` for localhost HTTP.

Set Express `trust proxy=1` in production so secure cookies and client IP behavior work correctly behind Render.

### 18.2 Password policy

- Minimum 15 Unicode code points.
- Maximum 128 Unicode code points.
- Allow spaces and arbitrary Unicode.
- No composition rule.
- Do not trim, lowercase, normalize, truncate, or silently transform password strings.
- Hash with Argon2id: `memoryCost=19456 KiB`, `timeCost=2`, `parallelism=1`.
- Benchmark is optional before final demo; do not weaken below these values.

### 18.3 Admin provisioning

There is no public admin registration or role-change endpoint.

`npm run db:seed-admin`:

- reads seed-only env values;
- validates/normalizes through normal domain utilities;
- hashes password using normal Argon2 settings;
- creates `role=admin` only when email is absent;
- no-ops if an admin with same email already exists;
- refuses to promote or overwrite an existing student with that email;
- never runs automatically at boot.

### 18.4 Authorization matrix

| Capability | Student | Admin |
| --- | --- | --- |
| Register/login/logout | Yes | Admin logs in but is seed-created |
| Read current equipment | Yes | Yes |
| Create/edit/status/archive equipment | No | Yes |
| View availability | Yes | Yes |
| Create reservation | Yes | No in v1 |
| View own reservations | Yes | N/A |
| View all reservations | No | Yes |
| Cancel own future reservation | Yes | Yes if acting on any future reservation |
| Create fault report | Yes | No in v1 |
| View own fault reports | Yes | N/A |
| View all fault reports | No | Yes |
| Resolve faults | No | Yes |
| Dashboard | No | Yes |

---

## 19. CSRF and Browser Request Security

Because authentication is cookie-based and stateful, unsafe requests require a synchronizer CSRF token.

- `GET /auth/csrf` creates/stores a cryptographically random token in the session and returns it.
- Require `X-CSRF-Token` on every `POST`, `PATCH`, and `DELETE`, including register/login/logout.
- Use constant-time token comparison where practical.
- Reject requests with `Sec-Fetch-Site: cross-site` for unsafe methods.
- If `Origin` exists, its origin must equal `APP_ORIGIN`.
- Otherwise, if `Referer` exists, its origin must equal `APP_ORIGIN`.
- SameSite cookies are defense-in-depth, not the only CSRF control.
- On successful login, regenerate session ID and rotate CSRF token. The client must replace its in-memory token with the returned token.
- Logout destroys the session; next login/register begins by obtaining a fresh token.

---

## 20. Frontend State Management Strategy

Use React Context only for authenticated-session UI state.

`AuthProvider` owns:

- `user`
- initial auth bootstrap/loading state
- current CSRF token
- `login()`
- `logout()`
- a thin authenticated request helper that injects the current CSRF token for unsafe requests and clears auth state on authoritative 401 responses

All other state is page/component-local:

- list data
- pagination
- search/filter values
- form values/errors
- mutation loading/errors

There is no global server-data cache. After successful mutations, explicitly refetch the affected page data.

Do not persist auth user/session/token in Web Storage.

---

## 21. Client Routing and UX Boundaries

Routes:

- Public: `/login`, `/register`.
- Authenticated: `/equipment`, `/equipment/:id`, `/reservations`, `/fault-reports`, `/fault-reports/new`.
- Admin: `/admin`, `/admin/equipment`, `/admin/equipment/new`, `/admin/equipment/:id/edit`, `/admin/reservations`, `/admin/fault-reports`.
- `/` redirects to `/admin` for admins, `/equipment` for students, or `/login` when unauthenticated.

`ProtectedRoute` and `AdminRoute` are navigation/UX guards only. Every protected API endpoint independently enforces session/role/ownership.

UX requirements:

- Show loading and error states for every API-backed page.
- Show server `fieldErrors` next to fields when available.
- Disable submit buttons while mutation is in flight to reduce accidental repeats; server idempotency/conflict rules remain authoritative.
- Equipment status is visibly labeled.
- Reservation page has `Upcoming` and `History` views.
- Equipment detail displays only server-returned availability slots.
- Fault form displays the safety instruction.
- Admin status/archive actions require a confirmation interaction when they can cancel future reservations.
- Dashboard uses cards and a simple table; no charts.

---

## 22. Caching Strategy

No application data cache in v1.

- No Redis.
- No TanStack Query cache.
- No dashboard cache.
- No background precomputation.

HTTP caching:

- Auth and dynamic API responses: `Cache-Control: no-store`.
- Production Vite hashed static assets: `public, max-age=31536000, immutable`.
- SPA `index.html`: `no-cache`/revalidation behavior so new deployments are picked up.

---

## 23. Background Jobs, Queues, Workers, and Scheduled Tasks

None.

Reservation completion is derived from time; no completion cron job exists. Faults require admin action. Dashboard is calculated on request. Session expiry is handled by cookie/session-store TTL behavior.

If a future feature appears to require a worker, it is out of v1 scope and must trigger an architecture revision rather than being added ad hoc.

---

## 24. External Services and Integrations

### 24.1 MongoDB Atlas

Production database and session storage. Use a Free replica-set cluster suitable for capstone/demo workload and MongoDB 8.0 baseline.

### 24.2 Render

One Node Web Service serves both API and compiled React SPA from one origin.

### 24.3 GitHub/GitHub Actions

Repository hosting and CI. Render deploys from protected `main`.

### 24.4 Explicitly absent integrations

No email provider, SMS provider, SSO provider, object storage, CDN integration beyond Render static serving, payment service, or analytics SaaS.

---

## 25. Configuration Strategy and Environment Variables

Application behavior constants that define the assignment (schedule, horizon, enums) are source-controlled constants, not environment variables.

### 25.1 Runtime environment variables

| Variable | Required | Meaning |
| --- | --- | --- |
| `NODE_ENV` | yes in deployed/test contexts | `development`, `test`, or `production` |
| `PORT` | no | Express port; default `3000`; Render supplies production port |
| `APP_ORIGIN` | yes | Exact browser origin allowed for CSRF origin checks; dev `http://localhost:5173`; prod exact HTTPS Render/custom origin |
| `MONGODB_URI` | yes | Replica-set capable MongoDB connection URI |
| `SESSION_SECRET` | yes | Cryptographically random secret, at least 32 random bytes |
| `LOG_LEVEL` | no | Pino level; default `info` |

### 25.2 Seed-only variables

- `ADMIN_BOOTSTRAP_NAME`
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD`

These must not be required for normal server startup.

### 25.3 Test/CI variables

- `MONGOMS_VERSION`, default `8.0.32`.
- Playwright base URL belongs in test configuration, not application runtime env.

### 25.4 Client environment

No client secret and no required `VITE_API_URL`. Browser code always calls relative `/api/v1` URLs.

---

## 26. Secrets Management

- Commit `.env.example`; never commit `.env`.
- Store Render production secrets in Render environment configuration.
- Use an Atlas database user scoped to `readWrite` on the application database rather than administrative cluster privileges.
- Generate `SESSION_SECRET` using a cryptographically secure tool; do not use memorable text.
- Seed-admin credentials should be used only during explicit seed execution and removed from shell/history/configuration where practical afterward.
- Prefer seeding Atlas from a trusted local machine temporarily allowlisted in Atlas; do not leave bootstrap password variables configured in the long-running Render service.
- Never expose secrets in client build-time variables.

---

## 27. Error-Handling Strategy

Create a central `AppError` type carrying HTTP status, stable code, safe message, and optional field errors.

Rules:

- Expected domain failures throw `AppError`.
- Express 5 async controller rejections flow to one error middleware.
- Map Mongo duplicate key code `11000` by collection/index to stable business codes.
- Malformed ObjectId is validation `400`; valid-but-missing resource is `404`.
- Do not expose raw Mongoose/Mongo/Argon errors to clients.
- Unknown error → `500 INTERNAL_ERROR` with generic message and request ID.
- Stack traces only go to server logs in non-user-visible form.
- Transaction transient errors may be retried by Mongo/Mongoose transaction helpers. If retries exhaust unexpectedly, return 500 and log full server-side context excluding secrets.

---

## 28. Logging and Observability

Use Pino + pino-http structured JSON logs.

Every request:

- receives `requestId = crypto.randomUUID()` unless a trusted internal propagation policy is later added;
- returns `X-Request-Id`;
- logs method, path, status, duration, requestId;
- logs actor `userId` and role when authenticated.

Never log:

- passwords or `passwordHash`
- cookies or `Set-Cookie`
- session IDs
- CSRF tokens
- authorization credentials
- `MONGODB_URI`
- `SESSION_SECRET`
- admin bootstrap password
- complete auth request bodies

Health endpoint is the minimum operational readiness signal. No metrics/trace backend is required in v1.

---

## 29. Validation Rules

### 29.1 General

- Zod validates route params, query strings, and bodies before controllers.
- Unknown body fields should be stripped only when harmless or, preferably for mutation DTOs, rejected so unexpected/mass-assignment attempts are visible. Use a consistent strict-object policy for mutation schemas.
- Strings are trimmed where specified.
- Server-normalized fields are normalized once before service execution.

### 29.2 User

- name: 2–80 after trim.
- email: valid email syntax, max 254, trim/lowercase.
- password: 15–128 Unicode code points; preserve exact string.

### 29.3 Equipment

- assetCode: uppercase, 2–30, required pattern.
- name: 2–100.
- category: 2–50.
- location: 2–100.
- description: 0–1000.
- non-available status reason: 1–500 after trim.

### 29.4 Reservation

- equipmentId: valid ObjectId.
- startAt: valid ISO instant.
- after parsing, must be strictly future.
- must map in `Asia/Colombo` to Monday–Friday and one of eight legal start times.
- must be `<= serverNow + 14 days`.
- equipment must be current and available at transaction write point.

### 29.5 Fault

- category enum exactly as specified.
- title 5–100.
- description 10–2000.
- resolutionNote 5–1000.

---

## 30. Security Requirements and Threat Considerations

### 30.1 Threats explicitly addressed

- Credential theft after DB compromise: Argon2id password hashes.
- Session theft from JS: HttpOnly cookie.
- Session fixation: regenerate session ID at login.
- CSRF: synchronizer token + Fetch Metadata + Origin/Referer checks + SameSite cookie.
- Vertical privilege escalation: no public role assignment; admin route middleware and service checks.
- Horizontal object access: ownership checks for student reservation/fault resources.
- Mass assignment: Zod allowlists/strict DTOs.
- Brute-force credential attempts: login/register IP rate limit.
- Duplicate bookings/races: unique partial index and transaction strategy.
- Booking-vs-maintenance race: both operations write equipment guard document inside transaction.
- Sensitive error leakage: centralized safe error mapping.
- Sensitive log leakage: explicit redaction.
- XSS defense-in-depth: React escaping + CSP + no unsafe HTML rendering.

### 30.2 Helmet/CSP

Production CSP baseline:

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self'`
- `img-src 'self'`
- `connect-src 'self'`
- `object-src 'none'`
- `base-uri 'self'`
- `form-action 'self'`
- `frame-ancestors 'none'`

Enable HSTS in production. Plain CSS avoids requiring `'unsafe-inline'`.

### 30.3 Rate limiting

- Register/login: 10 requests per 15 minutes per client IP.
- General API: 120 requests per minute per client IP.
- Use the library's in-memory store for this single-instance capstone. If horizontally scaling later, replace with shared backing store.

---

## 31. Performance and Scalability Considerations

- Single Render instance is sufficient for expected coursework scale.
- MongoDB queries must use projections and `lean()` for read-only lists.
- Pagination max is 50.
- Availability queries only inspect one equipment item and the 14-day time range.
- Dashboard aggregates directly against indexed collections on request.
- Regex equipment search is accepted because the equipment catalog is expected to be small. If catalog grows beyond roughly thousands/tens of thousands of records or query latency becomes material, revisit with normalized search fields or Atlas Search; do not prematurely add it.
- Transaction cancellation of many future bookings is acceptable for capstone scale. Very large future-reservation volumes would require revisiting transaction batch size/workflow.
- Do not introduce Redis or caching without measured evidence.

---

## 32. Concurrency and Idempotency

### 32.1 Same-slot race

The unique partial reservation index is the final authority. Two concurrent transactions for the same `{equipmentId,startAt}` cannot both commit active reservations. The losing request maps duplicate key to `409 RESERVATION_CONFLICT`.

### 32.2 Booking vs maintenance race

Both operations must perform a real write to the same equipment document by incrementing `reservationGuardVersion` inside their transaction. This creates the write-conflict synchronization point.

Required invariant after maintenance/unavailable/archive commit:

`no active reservation with equipmentId=<item> and startAt>commit-time serverNow`

A booking that wins before maintenance may subsequently be cancelled by maintenance in the same maintenance transaction; a booking that observes/loses to maintenance must fail. Do not reduce the booking equipment check to a read-only query.

### 32.3 Idempotent behaviors

- Cancel already-cancelled authorized reservation → 200 current resource.
- Archive already-archived existing equipment → 204.
- Repeat exact equipment status/reason → 200 no-op.
- Admin seed same existing admin email → no-op.
- Migration runner skips already-applied migration IDs.

No generic `Idempotency-Key` framework is implemented.

---

## 33. File and Storage Handling

There are no user file uploads in v1.

- Fault reports are text-only.
- Do not install Multer or image-processing/storage libraries.
- Do not write durable application data to Render filesystem.
- React build output is deployment artifact only and may live on ephemeral filesystem because it is recreated every deploy.

---

## 34. Naming Conventions

- JavaScript variables/functions: `camelCase`.
- React components/pages: `PascalCase` and `.jsx`.
- Server module files: lower camel/domain prefix + role suffix, e.g. `equipment.service.js`.
- Constants/enums in code: `SCREAMING_SNAKE_CASE` for constant identifiers; persisted enum values remain lowercase values defined in this spec.
- REST paths: lowercase kebab-case nouns, e.g. `/fault-reports`.
- JSON properties: `camelCase`.
- Stable error codes: `SCREAMING_SNAKE_CASE`.
- MongoDB collection names: lowercase as listed; do not rename implicitly.
- Index names: explicit descriptive snake_case names from Section 13.
- Tests: name by behavior, not implementation method.

---

## 35. Coding Conventions and Architectural Patterns

- Use ESM imports/exports everywhere.
- Prefer `async/await`.
- Use Express 5 promise-aware error flow; do not wrap every controller in repetitive catch/rethrow logic.
- Keep controllers small and deterministic.
- Keep domain constants out of components/controllers.
- Never trust a client-provided role, owner ID, current time, reservation phase, or equipment bookability flag.
- Do not duplicate reservation schedule logic in React. UI uses server-returned slots.
- Avoid Mongoose model hooks for cross-document business workflows; use explicit services/transactions.
- Avoid `Promise.all()` inside MongoDB transactions.
- Do not use raw object spreading from request bodies into model create/update calls.
- Prefer explicit field sets and DTO mappers.
- Do not add abstractions solely to reduce line count if they make the flow harder to explain in a viva.

---

## 36. Testing Strategy

### 36.1 Unit tests

Use Vitest for pure logic:

- email/asset normalization.
- ObjectId validation helper.
- reservation time validation and slot generation.
- phase/endAt derivation.
- pagination parsing.
- error-code mapping.
- DTO mapping.
- dashboard date-window helper.

Use fake timers or the shared clock abstraction for deterministic time tests.

### 36.2 Backend integration tests

Use Supertest against the real Express app and `MongoMemoryReplSet` with WiredTiger/MongoDB `8.0.32`.

Do not mock Mongoose for transaction/index correctness.

Integration test suite should:

- initialize replica set once per test run where practical;
- ensure indexes;
- isolate test data per test/file by database cleanup;
- use agent/cookie support for session tests;
- obtain real CSRF tokens before unsafe calls.

### 36.3 Frontend component tests

Use jsdom + React Testing Library + user-event.

Test behavior, not internal state:

- login/register validation and server error display.
- route guards.
- role-aware navigation.
- equipment list filters.
- availability rendering/selecting.
- cancellation confirmation/error behavior.
- admin status forms.
- fault form safety text.
- dashboard cards/table.

### 36.4 End-to-end tests

Use Playwright Chromium only for v1.

Use a test harness that starts a temporary transaction-capable Mongo replica set, seeds deterministic student/admin/equipment fixtures, starts the production-built app on a test port, and gives Playwright its base URL.

Keep E2E small and high-value.

---

## 37. Mandatory Test Scenarios and Boundaries

The following tests are release-blocking:

### Authentication/security

- Registration creates student regardless of attempted `role=admin` input.
- Duplicate email returns 409.
- Login correct/incorrect credentials.
- Session ID changes on login.
- CSRF missing/wrong on unsafe request returns 403.
- Cross-site Fetch Metadata rejection.
- Student blocked from every admin endpoint.
- Password hash never appears in API or logs.
- Logout destroys session.
- Expired/missing session returns 401.
- Production cookie flags are correct.

### Equipment

- Create/update validation.
- Asset code normalization and duplicate conflict.
- Non-admin mutations blocked.
- Maintenance/unavailable reason required.
- Archive hides equipment from catalog but history remains resolvable.
- Repeated archive is idempotent 204.

### Reservation

- Each of eight legal starts accepted on a legal weekday when within horizon.
- Before-opening/after-closing/half-hour-off-grid starts rejected.
- Saturday/Sunday rejected.
- start equal/past server time rejected.
- just inside and just outside 14-day boundary.
- unavailable/maintenance/archived equipment rejected.
- two concurrent same-slot requests produce one 201 and one 409.
- booking-vs-maintenance race never leaves future active booking on out-of-service equipment.
- transaction failure rolls back equipment guard/status/cancellation writes as appropriate.
- student can cancel own future reservation.
- student cannot cancel another student's reservation.
- started/past active reservation cannot be cancelled.
- repeated cancellation returns 200 current cancelled resource.

### Fault reports

- Student can create valid text-only report.
- Creating report never changes equipment status.
- Student only sees own reports.
- Admin can resolve once with valid note.
- Re-resolve returns 409.
- Archived equipment cannot receive a new report.

### Dashboard

- Archived equipment excluded.
- Status counts accurate.
- Upcoming count excludes cancelled and past.
- Open-fault count accurate.
- Top 5 uses non-cancelled starts from last 30 days and current equipment only.
- Deterministic tie sort by equipment name.

### Error/observability

- Validation response shape includes requestId.
- 500 hides stack/client-sensitive details and logs server context.
- `/api/*` unknown path returns JSON, not SPA HTML.

---

## 38. Development Environment Setup

Prerequisites:

- Git.
- Node.js 24.21.0 with npm 11.19.0.
- Docker Engine/Desktop with Compose v2.
- A browser supported by Vite; Chromium required for Playwright tests.

Setup sequence:

1. Clone repository.
2. Confirm Node matches `.node-version`.
3. Copy `.env.example` to root `.env` and set development values.
4. Run `npm ci` at repository root.
5. Start MongoDB: `docker compose up -d mongo`.
6. Run idempotent replica-set initialization: `npm run db:replset-init`.
7. Run `npm run db:migrate` (initial v1 should be a no-op if no migration files exist).
8. Set seed-only admin variables in local shell/root `.env`, run `npm run db:seed-admin`, then remove seed password when no longer needed.
9. Start server in terminal 1 with the workspace dev script.
10. Start client in terminal 2 with the workspace dev script.
11. Browse `http://localhost:5173`.

Local Mongo URI:

`mongodb://localhost:27017/lab_equipment?replicaSet=rs0&directConnection=true`

Vite proxies `/api` to `http://localhost:3000`.

Server dev command must use Node native `--watch` and `--env-file-if-exists=../.env`; do not add nodemon/dotenv/concurrently.

---

## 39. Build and Package-Management Strategy

Root npm workspaces: `client`, `server`.

Expected root scripts/names:

- `dev:client`
- `dev:server`
- `build`
- `start`
- `lint`
- `format`
- `format:check`
- `test`
- `test:client`
- `test:server`
- `test:e2e`
- `db:replset-init`
- `db:migrate`
- `db:seed-admin`

`npm run build` builds the React client to `client/dist`; server source needs no compilation.

Production server:

1. Mount `/api/v1` routes first.
2. Serve Vite assets from `client/dist`.
3. For non-API GET requests that do not match static assets, serve SPA `index.html`.
4. Never route unknown `/api/*` to `index.html`.

---

## 40. Deployment/Runtime Architecture

### 40.1 Render Web Service

One Node Web Service.

- Node version: `.node-version` = `24.21.0`.
- Build command: `npm ci && npm run build`.
- Start command: `npm start`.
- Server binds `0.0.0.0:$PORT`.
- Health path: `/api/v1/health`.
- Production `APP_ORIGIN` is exact HTTPS service/custom-domain origin.
- `NODE_ENV=production`.
- `trust proxy=1`.
- No dependence on local disk durability.

Free-tier operational note: Render free services can spin down after 15 minutes idle and may take about a minute to wake. Open the application shortly before viva/demo.

### 40.2 MongoDB Atlas

- Use a Free replica-set cluster on the MongoDB 8.0 baseline.
- Create a dedicated database user with application DB `readWrite` only.
- Add Render service outbound CIDR ranges to Atlas IP access list.
- Add the developer's current IP only when local access is required; remove stale entries.
- Do not use `0.0.0.0/0` as a permanent allowlist entry.
- `MONGODB_URI` is stored only as a server secret.

### 40.3 Production startup sequence

Before accepting traffic:

1. Load/validate env configuration.
2. Connect to MongoDB.
3. Explicitly ensure critical indexes.
4. Construct session store/middleware/app.
5. Start listening.

If DB connection or critical-index creation fails, abort startup rather than run a partially correct service.

---

## 41. CI/CD Expectations

GitHub Actions on pull requests and pushes to protected `main`.

Use:

- `actions/checkout@v7`
- `actions/setup-node@v7` with Node 24.21.0 and npm cache

Pipeline order:

1. Checkout.
2. Setup Node.
3. `npm ci`.
4. Install Playwright Chromium/system dependencies: `npx playwright install --with-deps chromium`.
5. `npm run lint`.
6. `npm run format:check`.
7. `npm run test` (unit/integration/component).
8. `npm run build`.
9. `npm run test:e2e` against production build/test harness.

Protect `main` so required CI must be green before merge. Render auto-deploys protected `main`; no custom deployment script is required.

Do not deploy failed test commits manually for normal workflow.

---

## 42. Migration and Versioning Strategy

### 42.1 Index lifecycle

Mongoose schemas declare index definitions as source of truth.

- Disable uncontrolled production `autoIndex`.
- Prefer setting global auto-indexing off consistently and call explicit `ensureCriticalIndexes()` during startup/test setup.
- `ensureCriticalIndexes()` calls each model's `createIndexes()`/equivalent and fails startup on error.
- This tradeoff is acceptable for the small capstone dataset. If deployment scale increases materially, move index builds into controlled release operations.

### 42.2 Data migrations

Future breaking schema/data changes use ordered JavaScript files:

`server/src/db/migrations/NNN-description.js`

`npm run db:migrate`:

- reads migrations in numeric order;
- checks `schema_migrations` for applied ID;
- executes unapplied migration;
- records ID/timestamp after success;
- is safe to rerun.

Do not add a third-party migration framework in v1.

### 42.3 API versioning

All v1 endpoints remain under `/api/v1`. Breaking request/response semantics require `/api/v2` or a coordinated versioned change rather than silently altering v1.

---

## 43. Implementation Phases and Recommended Build Order

### Phase 1 — Repository/tooling/local database

Create workspaces, dependency pins, lint/format config, `.node-version`, Vite skeleton, Express skeleton, Docker replica set, env loader, and DB connect/init commands.

**Gate:** client and server start; replica set supports a test transaction; lint/format run.

### Phase 2 — Server foundation/security

Implement request ID, logger, error model/middleware, JSON/media validation, Helmet/CSP, rate limits, sessions, CSRF, health endpoint, index startup.

**Gate:** health works; CSRF pre-auth session works; safe error envelope/requestId verified.

### Phase 3 — Users/auth/RBAC/admin seed

Implement User model, DTO, registration, login, logout, `me`, role middleware, Argon2, seed command.

**Gate:** mandatory auth/security integration tests pass; role self-assignment impossible.

### Phase 4 — Equipment domain

Implement model/indexes, validation, browse/search/filter/detail, admin create/edit/status/archive, transaction cancellation hook/service.

**Gate:** equipment CRUD/status/archive acceptance tests pass; history not deleted.

### Phase 5 — Reservation domain

Implement time helpers/constants, availability generation, reservation transaction, unique partial index conflict mapping, mine/admin lists, cancellation, race tests.

**Gate:** all schedule/horizon/concurrency/idempotency tests pass.

### Phase 6 — Fault reports

Implement model, create/mine/admin/detail/resolve flows and safety UI contract.

**Gate:** report creation never changes equipment status; ownership/RBAC and resolution tests pass.

### Phase 7 — Dashboard

Implement aggregate service and endpoint.

**Gate:** deterministic seeded metric tests pass.

### Phase 8 — React application

Implement auth provider, route guards, shell/nav, pages/forms by domain, plain CSS, refetch behavior, role-specific UX.

**Gate:** component tests cover forms/guards/core rendering; manual flow works against local API.

### Phase 9 — Cross-layer hardening

Complete integration/E2E suite, log-redaction tests, security-header/cookie tests, error states, rollback/race tests.

**Gate:** all CI commands green.

### Phase 10 — Deployment and viva preparation

Configure Atlas, Render, CI, production env, admin seed, README/demo data, and rehearsal.

**Gate:** deployed URL passes health/login/student/admin journeys; local fallback also works; cold-start caveat understood.

---

## 44. Dependencies Between Implementation Tasks

- Auth routes depend on session/CSRF/error foundations.
- Equipment mutations depend on admin RBAC.
- Reservations depend on stable User + Equipment models, transaction-capable MongoDB, critical indexes, and time helpers.
- Fault reports depend on User + Equipment models.
- Dashboard depends on stable Equipment + Reservation + FaultReport schemas.
- Frontend domain pages should consume frozen API contracts; do not invent temporary alternate endpoints.
- E2E depends on all domain modules and production SPA serving.
- Render deployment depends on successful production build, secure cookie behavior, transaction-capable Atlas, and health readiness.

---

## 45. Acceptance Criteria for Major Components

### 45.1 Authentication

- Public user registers only as student.
- Password stored only as Argon2id hash.
- Login regenerates session and rotates CSRF token.
- Session survives normal page refresh and expires at configured limit.
- Student receives 403/404 for admin resources.
- No auth token is stored in localStorage/sessionStorage.

### 45.2 Equipment

- Admin can create/edit/status-change/archive.
- Student cannot mutate.
- Search/filter works against current non-archived equipment.
- Maintenance/unavailable/archive atomically cancels future reservations.
- Historical references survive archive.

### 45.3 Reservation

- Only eight weekday start times, within 14 days and in future, can be created.
- Only available non-archived equipment can be booked.
- Concurrent same-slot requests produce one winner.
- Student can cancel only own future reservation.
- Admin can cancel any future reservation.
- Cancelled slot can be rebooked.

### 45.4 Faults

- Student creates text-only report.
- Report creation never changes equipment status.
- Student cannot view another student's report.
- Admin resolves exactly once with resolution note.

### 45.5 Dashboard

- Cards/tables match seeded database truth.
- No charts or additional analytics infrastructure.

### 45.6 Operations

- Local DB is replica set and supports transactions.
- Atlas deployment supports same transaction paths.
- Health fails when DB is unavailable.
- CI validates quality/tests/build/E2E before main merge.

---

## 46. Edge Cases and Failure Scenarios

Implement/test the following explicitly:

- Registration tries to submit `role`, `_id`, `passwordHash`, or admin fields.
- Email differs only by case/whitespace.
- Asset code differs only by case/whitespace.
- ObjectId is malformed vs valid-but-missing.
- User session expires while a form is open.
- CSRF token is from a pre-login session after login rotated it.
- Duplicate submission due to double-click/network retry.
- Availability page becomes stale because another student books before submit.
- Equipment becomes unavailable between availability display and booking submit.
- Booking and maintenance execute concurrently.
- Maintenance cancellation transaction aborts midway.
- Student tries to cancel exactly at/after `startAt`.
- Admin marks unavailable when an in-progress reservation exists; only future reservations are cancelled.
- Admin returns equipment to available; prior cancellations remain cancelled.
- Admin archives equipment with open faults; open fault history remains resolvable.
- Admin attempts to archive already archived equipment.
- Fault report references archived/missing equipment.
- Dashboard has fewer than five used equipment items or zero data.
- Search contains regex metacharacters; escape them before regex construction.
- MongoDB/Atlas is temporarily unreachable.
- Critical unique index creation finds invalid duplicate existing data; startup must fail and require data correction rather than continue without invariant.
- Render cold-start first request is slow.

---

## 47. Explicit Technical Decisions

1. Use MERN and JavaScript ESM, not TypeScript.
2. Use a modular monolith, not microservices.
3. Use one Render origin for SPA + API.
4. Use MongoDB-backed opaque sessions, not JWTs in Web Storage.
5. Use synchronizer-token CSRF for unsafe methods.
6. Use Argon2id with explicit parameters.
7. Use MongoDB replica-set transactions for maintenance/archive + cancellation invariants.
8. Use a partial unique index for active same-slot conflict authority.
9. Use fixed one-hour slots, server-generated availability, and UTC persistence with `Asia/Colombo` business validation.
10. Use equipment soft archive, not hard delete.
11. Derive reservation phase from time instead of scheduled completion jobs.
12. Keep fault-report workflow separate from equipment status workflow.
13. Use React Context only for auth; page-local state for data/forms.
14. Use native fetch, plain CSS, and controlled forms.
15. Use Zod server-side boundary validation.
16. Use explicit service/controller/model separation and no generic repository.
17. Use Vitest + real temporary replica set for integration tests.
18. Use Playwright Chromium for a small critical E2E suite.
19. Use explicit critical-index creation and simple ordered JS migrations.
20. Use GitHub Actions CI and Render auto-deploy from protected `main`.

---

## 48. Explicitly Rejected Alternatives and Reasons

| Rejected alternative | Reason |
| --- | --- |
| Institutional SSO/OIDC | No real IdP requirement/access; unnecessary dependency for capstone |
| Email verification/reset | User chose minimal lifecycle; would require mail service and extra security flows |
| JWT + localStorage | More token/revocation/browser exposure complexity; server sessions fit same-origin app |
| Redis session/cache | Unnecessary extra infrastructure for workload |
| Multi-lab model | User selected single lab; extra CRUD/model complexity hurts viva-readability |
| Reservation approval workflow | Extra states/races/UI without stated requirement |
| Flexible time intervals | More difficult overlap/concurrency problem; fixed slots satisfy project |
| Image uploads | Separate security/storage subsystem not required |
| Hard-delete equipment | Breaks historical references |
| Reservation completion cron | Phase can be derived from time |
| Microservices/event bus | No scale/organizational need; harms traceability |
| TypeScript | Not required by course; extra syntax/tooling for live rewrite evaluation |
| Axios | Native fetch is sufficient |
| Redux/Zustand | Auth context + local state is sufficient |
| TanStack Query | Server-data cache not required |
| React Hook Form | Controlled forms are enough and easier to explain |
| Tailwind/Bootstrap/MUI | Adds abstraction/dependency; plain CSS is adequate |
| Chart library | User selected cards/table only |
| CORS middleware | Same-origin production and Vite proxy development |
| Nodemon/dotenv/concurrently | Node 24 native watch/env-file; two-terminal dev is acceptable |
| Generic migration framework | Ordered JS migrations are sufficient for capstone |
| Generic idempotency-key system | Domain operations have explicit idempotent behavior |

---

## 49. Assumptions, Known Risks, and Limitations

### 49.1 Assumptions

- Project is evaluated as a course web application and does not need real university account integration.
- Only one engineering laboratory is represented.
- Project-defined business hours are Monday–Friday 08:30–16:30 `Asia/Colombo`.
- Equipment volume and concurrency are modest enough for one application instance and direct Mongo aggregates.
- Administrators are trusted laboratory staff provisioned out-of-band by seed command.

### 49.2 Known risks/accepted limitations

- **Unverified email:** email is only a unique login identifier. The app must not claim verified university identity.
- **No password recovery:** forgotten passwords can lock out a local account; this is accepted v1 scope.
- **No user-role admin UI:** admin creation/changes require controlled database/seed workflow.
- **No cancellation notification:** maintenance auto-cancellation is visible in reservation history with a reason, but no email/push is sent; lab staff may need to communicate externally.
- **Free Render cold start:** first request after idle can be slow; warm before demo.
- **Atlas/Render free-tier constraints:** not suitable as enterprise production SLA.
- **Regex catalog search:** acceptable for small catalog; not a large-scale search design.
- **Free-text category:** administrators may create spelling/casing variants; no category master entity in v1.
- **No equipment restore:** archive is effectively terminal in UI.
- **No full audit-log collection:** latest status actor/timestamps, reservation cancellation fields, fault resolution fields, and structured server logs provide limited auditability only.
- **Dashboard is reservation-based, not actual physical utilization:** a non-cancelled past reservation is counted as usage even if the student did not physically use the device.
- **Business hours are not asserted to be official university policy.**
- **Transaction design depends on replica-set MongoDB:** a plain standalone local MongoDB is unsupported.

### 49.3 Revisit triggers

Reopen architecture if any of these become requirements:

- multiple labs;
- actual university SSO;
- password recovery/email verification;
- file attachments;
- flexible/recurring bookings;
- horizontal app scaling;
- large catalog/full-text search;
- real audit/compliance requirements;
- notifications;
- official scheduling policy changes;
- high-volume maintenance cancellation batches.

---

## 50. Coding-Agent Execution Checklist

Before writing feature code, the coding agent must honor the following sequence and invariants:

1. Create the exact workspace/runtime/dependency baseline first.
2. Make local MongoDB a replica set before implementing transactions.
3. Implement shared errors, validation, request ID/logging, session, CSRF, and security middleware before domain routes.
4. Implement auth and admin seed before any admin domain endpoint.
5. Implement Equipment before Reservation.
6. Create the reservation unique partial index before relying on booking behavior.
7. Put booking and maintenance/archive invariants in services/transactions, never React/controllers.
8. Generate availability server-side; React must not duplicate schedule legality.
9. Preserve equipment/reservation/fault history; never hard-delete equipment.
10. Keep fault status and equipment status independent.
11. Implement DTO allowlists so internal/security fields never leak.
12. Write the mandatory concurrency/security integration tests before calling Reservation/Maintenance complete.
13. Do not add packages or architectural layers that are explicitly rejected in this spec.
14. Verify production cookie/CSRF/CSP behavior against same-origin Render build before deployment.
15. Keep `main` protected and deploy only a green production build.

When an implementation detail is not explicitly named here, choose the smallest conventional option that does **not** alter a documented module boundary, external contract, persistent schema, security property, or business rule. Any change to those areas requires a specification update rather than an implementation-time guess.

---

## Appendix A. Business Constants

These values must be centralized on the server and covered by tests:

| Constant | Value |
| --- | --- |
| Business timezone | `Asia/Colombo` |
| Legal weekdays | Monday–Friday |
| Legal start times | 08:30, 09:30, 10:30, 11:30, 12:30, 13:30, 14:30, 15:30 |
| Slot duration | 60 minutes |
| Booking horizon | 14 rolling days |
| Session lifetime | 8 hours |
| Auth rate limit | 10 requests / 15 minutes / IP |
| General API rate limit | 120 requests / minute / IP |
| Default page size | 12 |
| Max page size | 50 |
| JSON body limit | 16 KB |
| Dashboard usage window | prior 30 days |
| Dashboard Top N | 5 |

---

## Appendix B. Core Domain Invariants

The following invariants are release-blocking and should be represented directly in tests:

1. `User.role` cannot be assigned from public registration input.
2. A session cookie never contains password/auth payload; only an opaque session identifier is browser-visible.
3. Every unsafe request requires a valid session-bound CSRF token.
4. Archived equipment cannot be newly booked or fault-reported.
5. Equipment not in `available` state cannot be newly booked.
6. At most one `active` reservation exists for an equipment/start slot.
7. After maintenance/unavailable/archive transaction commits, that equipment has no future active reservations.
8. Cancelled reservations remain historical records and no longer occupy the unique active slot.
9. A student cannot cancel another student's reservation.
10. A student cannot cancel a reservation at or after its start time.
11. A fault report does not mutate equipment status.
12. Resolving a fault does not mutate equipment status.
13. Equipment archive does not delete reservations or faults.
14. Reservation phase is derived from time and is never persisted.
15. Dashboard data is derived from authoritative domain collections and excludes archived equipment where specified.
