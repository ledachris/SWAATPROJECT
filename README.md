<<<<<<< HEAD
# SWAAT Student Work & Guide App

SWAAT is a Node.js/Express student productivity app with SQLite storage, document uploads, student accounts and an administrator dashboard.

## Requirements
- Node.js 20 or newer (Node.js 22 LTS recommended)
- npm

## Run locally on Windows
1. Extract this ZIP and open the `SWAATPROJECT` folder in VS Code.
2. Open PowerShell in that folder and run:

   ```powershell
   npm install
   Copy-Item .env.example .env
   ```

3. Edit `.env`. Set `JWT_SECRET` to a private random value of at least 32 characters. Set `ADMIN_EMAIL` to the email address you will use for the administrator account.
4. Start the app:

   ```powershell
   npm start
   ```

5. Open `http://localhost:3000` and register an account using the exact email in `ADMIN_EMAIL`.
6. Stop the server with Ctrl+C, then start it again with `npm start`. On startup, SWAAT grants administrator access to an existing account matching `ADMIN_EMAIL`.
7. Sign in at `http://localhost:3000/admin.html` with that account.

For development with automatic restart, run `npm run dev`. Run `npm run check` for JavaScript syntax checks.

## Deploy to Railway
This project includes `railway.json` with the Node.js start command and `/api/health` health check. The app listens on `0.0.0.0` and uses Railway's injected `PORT` value.

1. Push the project to a **private** GitHub repository. Do not upload `.env`, `swaat.sqlite`, or `uploads/`.
2. In Railway, create a project and deploy the GitHub repository as a service.
3. Add a Railway **Volume** and mount it at `/data`.
4. Add these service variables in Railway:

   ```text
   NODE_ENV=production
   JWT_SECRET=<a new private random secret of at least 32 characters>
   ADMIN_EMAIL=<the administrator account email>
   DATABASE_PATH=/data/swaat.sqlite
   UPLOAD_DIR=/data/uploads
   ```

   Do not manually set `PORT`; Railway supplies it.

5. Deploy. Open the generated public domain and register the administrator account using the exact `ADMIN_EMAIL` value.
6. Restart/redeploy the service once after that account exists. Startup promotes the matching account to administrator. Then sign in at `/admin.html`.
7. Confirm `/api/health` returns `{"status":"ok","app":"SWAAT API"}` and test registration, login, notes, timetable, flashcards, uploads/downloads and admin student search.

**Persistent storage is required.** Both the SQLite database and uploaded documents must live under `/data`, which is the mounted volume. If you omit the volume or use the default local paths in a hosted container, data can disappear when the container is replaced. Keep the database and uploads on the same persistent volume and back them up regularly.

## Environment variables
| Variable | Purpose |
|---|---|
| `PORT` | HTTP port. Set automatically by Railway; defaults to 3000 locally. |
| `NODE_ENV` | Set to `production` on the hosted service. |
| `JWT_SECRET` | Private signing secret, minimum 32 characters. |
| `ADMIN_EMAIL` | Existing account email to promote to administrator at startup. |
| `DATABASE_PATH` | SQLite file path. Use `/data/swaat.sqlite` on Railway. |
| `UPLOAD_DIR` | Uploaded file directory. Use `/data/uploads` on Railway. |

## Administrator dashboard
- Open `/admin.html` and sign in with the account matching `ADMIN_EMAIL`.
- Dashboard API endpoints are protected by server-side JWT authentication and administrator-role checks.
- The dashboard displays student account details and counts of modules, notes, flashcards and uploaded documents. It does not return password hashes or private student content.
- Student search supports name/email, course filtering and pagination.
- Do not share administrator credentials or commit secrets.

## Security and privacy
- Passwords are stored as bcrypt hashes.
- JWTs are verified on protected API routes; admin endpoints additionally check the current database role.
- User-owned records are scoped to the authenticated user ID.
- Authentication endpoints have a basic per-process rate limit.
- Request body sizes are limited; inputs are trimmed and length-checked; SQL uses prepared statements.
- Uploads are restricted to PDF, DOC, DOCX and TXT, limited to 50 MB, renamed to random server-side names, and checked against basic file signatures.
- Security response headers and a Content Security Policy are enabled. HTTPS is provided by the hosting platform and HSTS is enabled for secure production requests.
- Keep `.env`, database files, backups and uploads private. Configure backups and review privacy obligations before inviting real students.

## Important deployment limitation
The current app uses SQLite and is designed for a single application instance with a persistent disk. Do not scale it horizontally to multiple replicas or attach multiple app instances to the same SQLite file. For multi-instance production use, migrate to a managed database such as PostgreSQL and object storage for uploaded files. The in-memory rate limiter is also per process; use a shared rate limiter store before scaling.

## Project structure
- `server.js`: Express API, authentication, database, uploads and admin API
- `public/index.html`: student application
- `public/style.css`, `public/script.js`: student interface
- `public/admin.html`, `public/admin.css`, `public/admin.js`: administrator dashboard
- `railway.json`: Railway startup and health-check configuration
- `uploads/`: local uploaded documents (created automatically)
- `swaat.sqlite`: local SQLite database (created automatically)

Audio transcription/text-to-speech is not included. The notes area stores and downloads supported documents.


## Administrator account setup (important)

`ADMIN_EMAIL` does not create a user or set a password. The account must first exist
and the person must authenticate with its own password.

1. Set `ADMIN_EMAIL` to the exact account email in the hosting environment.
2. If the account does not exist, create it through the normal SWAAT registration
   flow using that email and a strong password.
3. If the account already exists, sign in once with its existing password. The
   backend promotes that authenticated account to administrator.
4. Open `/admin.html` and sign in with the same email and password.
5. Administrator API routes check the database role on every request.

Do not place passwords or JWT secrets in source control, screenshots, or chat.
If a password has been exposed, change it before deploying.
=======
# SWAATPROJECT
>>>>>>> 8e6b1a6cebedd3ae1806b0be902055bf0325c32c
