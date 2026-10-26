# Deployment: Render and MongoDB Atlas

The repository contains the deployable application and `render.yaml`. Creating a
hosted service, configuring Atlas access, and verifying a public URL require your
Render, Atlas and GitHub accounts. Local checks do not verify a hosted release.

## 1. Run the release checks

Use Node from `.node-version` and Bun from `.bun-version`:

```sh
bun install --frozen-lockfile
bun x --bun playwright install --no-shell chromium
bun run lint
bun run format:check
bun run test
bun run build
bun --no-env-file run test:e2e
```

Playwright uses an isolated HTTPS application on `127.0.0.1:4310`, a temporary
MongoDB replica set, a temporary self-signed certificate and test-only accounts.
It requires OpenSSL and access to download Chromium and MongoDB on the first run.
The command above prevents loading `.env`; the harness always uses its own
database, session secret and seed accounts. Do not run another
service on port 4310. On Arch, install Chromium's system libraries through the
system package manager if Playwright reports missing libraries; the CI runner is
Ubuntu and installs them with `--with-deps`.

## 2. Configure GitHub

Push the repository to GitHub and enable Actions. The `CI` workflow runs on pull
requests and pushes to `main`, with the release checks above. Browser failures
retain screenshots and traces as a short-lived workflow artifact.

Protect `main`: require the **Quality and E2E** check and pull-request review before
merge. Repository branch protection must be configured in GitHub settings; a
workflow file alone does not enforce it. Do not bypass failed release checks.

## 3. Prepare Atlas

1. Create a transaction-capable replica-set cluster using the MongoDB 8.0 baseline.
2. Create a dedicated database user with `readWrite` only on `lab_equipment`.
3. Copy its application connection string, including `/lab_equipment` as the database
   and the Atlas host/replica-set settings. URL-encode special characters in credentials.
   Do not use the local `directConnection=true` URI for Atlas.
4. Add your Render service's outbound CIDR ranges to the Atlas IP access list.
   Render exposes these in the service dashboard. Temporarily allow your own IP
   when checking or seeding locally; remove stale entries afterward. Do not leave
   a permanent `0.0.0.0/0` allowlist entry.

The application stores both domain data and sessions in this database. Startup
creates the declared indexes before listening. Fix index conflicts rather than
removing uniqueness constraints. No data migration is required for v1:
`bun run db:migrate` is an explicit no-op. Introduce ordered, recorded migrations
with the first future data migration; startup index creation remains separate.

## 4. Create the Render service

Create a Blueprint from this GitHub repository using `render.yaml`. Keep the
repository root as the service root, so both workspaces and `client/dist` are
available. The Blueprint configures one Node web service:

- Node `24.21.0`, Bun `1.4.3`.
- Build: `NODE_ENV=development bun install --frozen-lockfile && bun run build`.
  Development dependencies are needed to compile Vite; runtime remains production.
- Start: `bun run start`; binds `0.0.0.0:$PORT`.
- Health: `/api/v1/health`.
- Deploy trigger: `checksPass`, after GitHub checks pass.

Supply the two unsynced values in the Render dashboard:

- `APP_ORIGIN`: the exact public HTTPS origin, e.g. `https://your-service.onrender.com`,
  without a trailing slash, path or query. If Render assigns a different hostname,
  update this value and redeploy. Change it again when adopting a custom domain.
- `MONGODB_URI`: the Atlas secret for the dedicated application database user.

The Blueprint generates `SESSION_SECRET`; keep it stable across normal releases.
Rotating it signs users out. `NODE_ENV=production` enables host-only Secure,
HttpOnly, SameSite=Lax cookies, CSP and HSTS. Express trusts one proxy hop for
Render's HTTPS termination. Do not add bootstrap credentials or client `VITE_*`
secrets to the long-running service. There is no persistent application disk.

## 5. Seed the administrator

Use a trusted local machine temporarily allowlisted in Atlas. Put production
settings and the three `ADMIN_BOOTSTRAP_*` values in a private environment file
outside the repository, readable only by you. Use a unique 15–128-character
password. Run the existing seed command with that file:

```sh
bun --env-file=/private/path/lab-production.env run db:seed-admin
```

The file should include production `NODE_ENV`, exact HTTPS `APP_ORIGIN`,
`MONGODB_URI`, `SESSION_SECRET` and the bootstrap name/email/password. No production
secret belongs in source control or a client build. Remove the bootstrap password
from the private file after seeding. An existing administrator is left unchanged;
an existing student is never promoted or overwritten. Invalid bootstrap values
report field names and validation messages without printing their values.

## 6. Verify the public release

```sh
curl --fail https://your-service.onrender.com/api/v1/health
```

Then use the actual HTTPS site:

1. Refresh `/login`, `/equipment` and `/admin`; SPA routes must load directly.
2. Confirm unknown `/api/*` returns JSON 404, not the SPA document.
3. Sign in as admin; confirm `__Host-lab.sid` is Secure/HttpOnly/SameSite=Lax with
   path `/` and no Domain. Check CSP and HSTS response headers.
4. Register a student, book and cancel a returned slot, submit a fault, then resolve
   it as admin. Confirm maintenance/archive cancellation and dashboard counts.
5. Refresh a signed-in page, log out and confirm protected pages require sign-in.

Render's free service can sleep after inactivity; open it before a demo and allow
for a cold start. If hosted access fails, use the local replica-set/Vite workflow
in the README. A successful local E2E run does not replace this hosted verification.

References: [Render Blueprint fields](https://render.com/docs/blueprint-spec),
[Render Bun versions](https://render.com/docs/bun-version),
[deploys after checks](https://render.com/docs/deploys),
[Playwright browsers](https://playwright.dev/docs/browsers).
