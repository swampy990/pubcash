# Pub Cash Management

A small internal web app for managing till floats, cash counts, and safe drops for a pub.
The frontend and backend are fully decoupled: a React single-page app talks to a Python
(FastAPI) JSON API over REST, backed by PostgreSQL.

## Architecture

- **Backend**: FastAPI + SQLAlchemy + Alembic, Python 3.12. JWT-based authentication.
- **Frontend**: React 18 + Vite, built as a static site and served by nginx in production.
- **Database**: PostgreSQL 16.
- Everything is wired together with Docker Compose so it runs the same on your laptop or a server.

## Features

- **Login / registration**: users register with a username, password, and a shared invite code
  (set via `REGISTRATION_INVITE_CODE`); new accounts start as `pending` and cannot log in until
  an admin approves them.
- **Admin controls**: approve pending accounts, suspend/reactivate accounts, delete accounts,
  promote a staff account to admin or demote an admin back to staff, and trigger a password reset
  (generates a temporary password the user must change on next login).
- **Roles**: `admin` (full access, including user management) and `staff` (can only see and
  manage their own till sessions and safe entries). There must always be at least one admin
  account, so demoting or deleting the last remaining admin is blocked, and nobody can remove
  their own admin privileges (an admin can promote or demote anyone but themselves).
- **Till float & cash counts**: open a till session by counting the starting float
  (broken down by note/coin denomination), then close it by counting the till again. The app
  computes the expected closing amount (opening float + recorded cash sales − any drops to the
  safe during the session) and flags the variance against what was actually counted. Opening a
  till automatically records that float as a withdrawal from the safe, so the safe balance and
  the tills always agree on where the float cash currently is. An open session can be cancelled
  (by whoever opened it, or an admin) if it was started in error — this reverses that automatic
  withdrawal but leaves any manual drops made during the session untouched, and keeps the
  session on record as cancelled rather than deleting it. Admins can reopen a closed session (as
  long as its till doesn't already have a different session open) to correct a mis-counted close
  — the previous count is kept and pre-filled into the close form for editing rather than wiped,
  and what it was before is recorded in the session's note either way.
- **Safe & drop tracking**: log cash drops from a till into the safe, admin-only withdrawals
  (e.g. banking) and manual adjustments, and see a running safe balance. Once a till session is
  closed, it shows up on the Safe page as a card with just its closing total (no denomination
  detail) and an "Import to safe" button — take the counted cash out of the till and into the
  safe, then hit the button to record that as a drop.
- **Close business day**: once every till is closed and imported to the safe, an admin can
  physically count everything in the safe (full note/coin breakdown) and hit "Close business
  day" to reconcile that count against what the ledger expects, recording any variance. Like the
  till close, it deliberately doesn't auto-correct the safe balance to match the count — it's a
  record for someone to follow up on. The button is disabled with an explanation if any till is
  still open or has closed cash not yet imported.
- **Reports** (admin only): a date-range summary (floats, cash sales, variance, safe activity)
  and a variance/discrepancy alert list for sessions whose variance exceeds a configurable
  threshold.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (bundled with recent Docker
  Desktop / Docker Engine as `docker compose`).

## Deploying to a live server (DigitalOcean or similar)

For a headless server with a domain name and general (internet) access, use
**[DEPLOY.md](./DEPLOY.md)** and `docker-compose.prod.yml` instead of the steps below —
it walks through the whole thing over SSH, with Caddy handling automatic HTTPS and only
ports 80/443 exposed. The "Getting started" section below is for running it on your own
machine (`localhost`) while developing.

## Getting started

1. Copy the example environment file and adjust values (especially `SECRET_KEY` and the
   initial admin password) for your setup:

   ```bash
   cp .env.example .env
   ```

2. Build and start everything:

   ```bash
   docker compose up --build
   ```

   This starts three containers: `db` (Postgres), `backend` (FastAPI on port 8000, applies
   database migrations and creates the first admin account automatically on startup), and
   `frontend` (the built React app, served on port 8080).

3. Open the app at **http://localhost:8080**.

4. Log in with the initial admin account (from your `.env`, defaults to
   `admin` / `ChangeMe123!`) and **change the password immediately** via the account menu.

5. As the admin, open **Till Session → Manage tills** to add your pub's tills (e.g. "Main Bar",
   "Beer Garden"), then approve any staff accounts that register from **Users**.

The interactive API documentation (Swagger UI) is available at **http://localhost:8000/docs**
once the backend is running.

## Running without Docker (local development)

Backend:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+psycopg2://pubcash:pubcash@localhost:5432/pubcash
alembic upgrade head
python -m app.seed
uvicorn app.main:app --reload
```

(You'll need a local Postgres instance reachable at that `DATABASE_URL` — the simplest way is
`docker compose up db`.)

Frontend:

```bash
cd frontend
npm install
npm run dev
```

The dev server runs on http://localhost:5173 and expects the API at http://localhost:8000
(set `VITE_API_URL` in a `frontend/.env` file to override).

## Notes on this build

This session's sandbox had no access to the Python/Node package registries, so the stack
could not be `pip install`ed / `docker build`t and run end-to-end here. Every file was
written carefully against the framework APIs and cross-checked by hand (and the pure Python
cash-total logic was unit-tested directly), but **please run `docker compose up --build` and
click through the flows yourself before relying on this for real money** — pay particular
attention to the till open/close variance calculation and the admin approve/suspend/delete
flows the first time you use them.

## Security notes for real-world use

- Change `SECRET_KEY` and the initial admin password before exposing this beyond your own
  machine.
- Registration requires a shared `REGISTRATION_INVITE_CODE` (set in `.env`) in addition to
  admin approval — change it from the default before going live, and share the real value with
  staff out-of-band rather than posting it publicly.
- Deleting a user is blocked if they have till session or safe transaction history (for audit
  reasons) — suspend the account instead in that case.
- For production use beyond a single trusted local network, put this behind HTTPS — see
  [DEPLOY.md](./DEPLOY.md), which sets this up with a Caddy reverse proxy automatically.
