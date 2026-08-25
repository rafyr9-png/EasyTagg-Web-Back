# Easy Tagg — Backend

Node.js + TypeScript + Express + SQLite API for Easy Tagg, a baseball pitch/at-bat tagging app. Handles authentication (password, magic link, Google OAuth), per-user data storage for games/players/tags, a legacy-data migration path, and serves the built React frontend as static files in production.

## Tech stack

- **Runtime**: Node.js (ESM, `type: module`), TypeScript compiled with `tsc`
- **Framework**: Express 5
- **Database**: SQLite via `better-sqlite3` (WAL mode), file-based, no external DB server
- **Auth**: `jsonwebtoken` (access tokens), `bcryptjs` (password/token hashing), `passport` + `passport-google-oauth20` (Google OAuth), httpOnly cookies for refresh tokens
- **Email**: `nodemailer` (only used if SMTP is configured; otherwise verification/magic links are printed to the console in development)

## Project structure

```
backend/
├── src/
│   ├── server.ts          # App bootstrap, DB schema, auth routes, CORS, static file serving
│   ├── lib/
│   │   ├── jwt.ts         # Shared access-token signing (server.ts + dev.ts)
│   │   └── tagColumns.ts  # Shared column list for the `tags` table (tags.ts + migrate.ts)
│   └── routes/
│       ├── games.ts       # CRUD for games (activities)
│       ├── players.ts     # CRUD for players
│       ├── tags.ts        # CRUD for tagged pitches/at-bats
│       ├── migrate.ts     # One-time migration of legacy localStorage snapshot → normalized tables
│       └── dev.ts         # Dev-only instant login (blocked in production unless explicitly allowed)
├── data/                  # SQLite database file lives here (gitignored)
├── dist/                  # Compiled JS output (gitignored, built by `npm run build`)
└── tsconfig.json
```

## Requirements

- Node.js 20+
- npm

## Environment variables

Copy your own `.env` in the `backend/` folder (never commit it — see `.gitignore`). None of these have a working default in production except where noted.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | recommended | — | Set to `production` in deployed environments. Enables strict checks (JWT secret length, SMTP requirement) and disables the dev-login endpoint. |
| `PORT` | no | `4000` | HTTP port the server listens on. |
| `JWT_SECRET` | **yes in production** | `dev-change-me` (dev only) | Signing secret for access tokens. Must be ≥32 characters in production — the server refuses to start otherwise. |
| `ACCESS_TOKEN_MINUTES` | no | `60` | Access token lifetime in minutes. |
| `REFRESH_TOKEN_DAYS` | no | `30` | Refresh-token cookie lifetime in days. |
| `DB_FILE` | no | `data/easytagg.sqlite` | Path to the SQLite file. The containing directory is created automatically if missing. |
| `FRONTEND_URL` | recommended | `http://localhost:5173` (dev) | Public URL of the frontend. Used to build redirect URLs after email verification, magic links, and Google OAuth. |
| `PUBLIC_API_URL` | recommended | `http://localhost:{PORT}` | Public URL of this API. Used inside verification email links. |
| `ALLOWED_ORIGINS` | recommended | falls back to `FRONTEND_URL` | Comma-separated list of allowed CORS origins. In non-production, any `http://localhost:<port>` / `http://127.0.0.1:<port>` origin is also allowed automatically, so local dev survives Vite picking a different port. |
| `SKIP_EMAIL_VERIFICATION` | no | `false` | **Demo-only escape hatch.** When `true`, new accounts are marked verified immediately and can log in without SMTP being configured. Never enable this for a deployment holding real user data. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | no (required in production unless `SKIP_EMAIL_VERIFICATION=true`) | — | SMTP credentials for sending real verification/magic-link emails. If `SMTP_HOST` is unset in development, emails are printed to the server console instead of sent. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` | no | — | Google OAuth app credentials. Google sign-in returns `503` until all three are set. `GOOGLE_CALLBACK_URL` must exactly match the redirect URI registered in Google Cloud Console. |
| `ALLOW_DEV_LOGIN` | no | `false` | Explicitly re-enables `POST /api/dev/login` when `NODE_ENV=production`. Leave unset in production. |
| `RENDER_EXTERNAL_URL` | no | — | Auto-set by Render; used as a fallback for `FRONTEND_URL`/`PUBLIC_API_URL` if those aren't set explicitly. |

## Running locally

```bash
npm install
npm run dev     # tsx watch — auto-restarts on file changes, http://localhost:4000
```

Other scripts:

```bash
npm run build   # tsc -> dist/
npm start       # node dist/server.js (run the compiled build)
npm run format  # prettier --write
```

## Database

SQLite file at `DB_FILE`, created automatically on first run (WAL mode). Tables:

| Table | Purpose |
|---|---|
| `users` | Accounts: email, password hash (nullable for Google-only accounts), `email_verified`, `google_id`. |
| `tokens` | Hashed one-time/refresh tokens (`type`: `verify`, `magic`, `refresh`), with expiry and `used_at`. |
| `snapshots` | One JSON blob per user — the legacy client's full localStorage state, used for cloud sync and as the source for migration. |
| `games` | Normalized "activity"/game records (`name`, `date`, `home`, `away`, `game_type`). |
| `players` | Normalized player roster (`name`, `team`, `role`, `bat`/`thr` hand, etc.). |
| `tags` | One row per tagged pitch/at-bat — pitch count, zone location, result, contact quality, trajectory, clip timestamps, etc. (39 columns, see `src/lib/tagColumns.ts`). |
| `lineups`, `history_events` | Reserved for future structured lineup/history tracking; not yet exposed via any route. |

All per-user tables are scoped by `user_id` and every route enforces `WHERE user_id = <authenticated user>` — there is no cross-user access except where explicitly noted below.

## Authentication

- **Password**: `bcryptjs` hash, 12 rounds. Login requires `email_verified = 1` (bypassable per-deployment via `SKIP_EMAIL_VERIFICATION`).
- **Email verification / magic links**: single-use tokens, stored hashed, expire after 30 minutes, delivered by email (or logged to console in dev without SMTP).
- **Google OAuth**: `passport-google-oauth20`, session-less (`session: false`), auto-creates a verified account on first login.
- **Access tokens**: short-lived JWT (`Authorization: Bearer <token>`), required on every non-public route via the `auth` middleware.
- **Refresh cookie**: `et_refresh`, httpOnly + `Secure` in production + `SameSite=Lax`, issued alongside login/OAuth/magic-link — currently written but not yet consumed by any endpoint (no refresh-token exchange route exists yet).

## API reference

Base path for everything below is `/api`. Routes marked 🔒 require `Authorization: Bearer <accessToken>`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Create an account (`email`, `password` ≥8 chars, optional `name`). Sends a verification email (or logs it in dev). Blocked with `503` in production if SMTP isn't configured and `SKIP_EMAIL_VERIFICATION` isn't set. |
| GET | `/auth/verify?token=` | — | Consumes a verification token, marks the account verified, redirects to `FRONTEND_URL/?verified=1`. |
| POST | `/auth/login` | — | `{ email, password }` → `{ accessToken, user }` + sets refresh cookie. `401` on bad credentials, `403` if unverified. |
| POST | `/auth/magic/request` | — | `{ email }` → always `200` (doesn't reveal whether the account exists); emails a one-time sign-in link if it does. |
| GET | `/auth/magic/consume?token=` | — | Consumes the magic-link token, marks the account verified, redirects to `FRONTEND_URL/?token=<jwt>`. |
| GET | `/auth/google` | — | Starts Google OAuth. `503` if Google isn't configured. |
| GET | `/auth/google/callback` | — | OAuth callback; on success redirects to `FRONTEND_URL/?token=<jwt>`. |
| GET | `/auth/me` | 🔒 | Returns the current user's public profile. |
| POST | `/auth/logout` | — | Clears the refresh cookie. |

### Sync (legacy client cloud snapshot)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/sync/snapshot` | 🔒 | Returns the caller's saved localStorage snapshot (`{ data, updatedAt }`), or `{}` if none exists. |
| PUT | `/sync/snapshot` | 🔒 | Upserts `{ data }` (arbitrary JSON object) as the caller's snapshot. |

### Games

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/games` | 🔒 | List the caller's games, newest first. |
| POST | `/games` | 🔒 | Create a game (`name`, `date`, `home`, `away`, `game_type`). |
| PUT | `/games/:id` | 🔒 | Update a game. `404` if it doesn't exist or isn't owned by the caller. |
| DELETE | `/games/:id` | 🔒 | Delete a game (no-op if not found). |

### Players

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/players` | 🔒 | List the caller's players, alphabetical. |
| POST | `/players` | 🔒 | Create a player (`name`, `num`, `team`, `role`, `bat`, `thr`, `position`, `db_player_code`). |
| PUT | `/players/:id` | 🔒 | Update a player. `404` if it doesn't exist or isn't owned by the caller. |
| DELETE | `/players/:id` | 🔒 | Delete a player (no-op if not found). |

### Tags

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tags?game_id=` | 🔒 | List the caller's tags, optionally filtered to one game, newest first. |
| POST | `/tags` | 🔒 | Create a tag. Requires `game_id` and that the game belongs to the caller (`404` otherwise). Accepts the full tag schema — see `src/lib/tagColumns.ts`. |
| PUT | `/tags/:id` | 🔒 | Update `result`, `final_result`, `contact_quality`, `trajectory`, `note` on an existing tag. `404` if not found/owned. |
| DELETE | `/tags/:id` | 🔒 | Delete a tag (no-op if not found). |

### Migration (legacy snapshot → normalized tables)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/migrate/preview` | 🔒 | Reads the caller's snapshot and reports counts + conflict counts (rows whose id already exists in the normalized tables) without writing anything. |
| POST | `/migrate/snapshot` | 🔒 | Same source data, actually inserts into `games`/`players`/`tags` with `INSERT OR IGNORE` (existing ids are skipped silently). |

### Misc

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/dev/login` | — | **Dev only.** Creates/reuses a fixed `dev@local` user and returns a valid access token, skipping the whole auth flow. Returns `403` when `NODE_ENV=production` unless `ALLOW_DEV_LOGIN=true`. |
| GET | `/health` | — | `{ ok: true }` liveness check. Used as the Render health check path. |

## Static frontend serving

In production, `server.ts` also serves the built React app: it serves `../frontend/dist` as static files and falls back to `index.html` for any non-`/api` GET request (SPA routing). This only works when both `frontend/` and `backend/` are checked out as siblings in the same repo — see the root `DEPLOYMENT.md` for the single-service Docker deployment option. If you deploy frontend and backend as two separate services instead (e.g. two Render services, one Render + one Vercel), this static-serving path is simply unused and harmless.

## CORS

Configured via `ALLOWED_ORIGINS` (comma-separated). In development, any `http://localhost:*` / `http://127.0.0.1:*` origin is accepted automatically regardless of `ALLOWED_ORIGINS`, so a Vite dev server that picks a non-default port doesn't get rejected. In production, only origins explicitly listed in `ALLOWED_ORIGINS` are accepted.

## Deployment notes

- See the repository root `DEPLOYMENT.md` and `render.yaml`/`Dockerfile` for a single-service deployment (this backend serving the built frontend).
- On Render's free tier, the filesystem is ephemeral — the SQLite database (and anything written to `data/`) can be lost on redeploy or after the service sleeps and wakes up. Fine for demos, not for real user data; migrate to a persistent disk or a managed Postgres before relying on this for production data.
- Never set `ALLOW_DEV_LOGIN` or `SKIP_EMAIL_VERIFICATION` on a deployment with real user data.
