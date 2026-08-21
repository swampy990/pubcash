# Deploying to a DigitalOcean droplet (headless, no GUI needed)

This covers taking the app from your laptop to a live HTTPS site on a DigitalOcean droplet,
entirely over SSH. `docker-compose.prod.yml` puts a [Caddy](https://caddyserver.com/) reverse
proxy in front of everything — it gets and renews a free HTTPS certificate automatically and is
the *only* container reachable from the internet. Postgres, the API, and the frontend's nginx
all stay on the internal Docker network.

## 1. Point your domain at the droplet

Create the droplet first (see step 2) if you don't have its IP yet, then in your DNS provider
add an **A record** for the (sub)domain you want to use, e.g.:

```
cash.mypub.co.uk   A   <droplet public IPv4>
```

DNS can take a few minutes to propagate. Caddy will fail to get a certificate until this
resolves, so it's worth doing this step first and double-checking with `dig cash.mypub.co.uk`
or `nslookup cash.mypub.co.uk` before moving on.

## 2. Create the droplet

- Image: **Ubuntu 24.04 (LTS) x64**
- Plan: the cheapest "Basic" droplet (1 vCPU / 1GB RAM) is enough for a small pub's traffic
- Authentication: add your SSH key (avoid password auth)
- Anything else (region, hostname) is up to you

Note the droplet's public IPv4 address once it's created.

## 3. Get the code onto the server

Either upload the zip you were given:

```bash
# from your own machine
scp pub-cash-management.zip root@<droplet-ip>:~

# back on the droplet
apt-get update && apt-get install -y unzip
unzip pub-cash-management.zip
cd pub-cash-management
```

Or, if you've pushed it to a git remote (recommended so future updates are a `git pull` away):

```bash
git clone <your-repo-url> pub-cash-management
cd pub-cash-management
```

## 4. Configure environment variables

```bash
cp .env.example .env
vi .env
```

Set, at minimum:

- `DOMAIN` — the domain you pointed at the droplet in step 1
- `CADDY_ACME_EMAIL` — an email address you actually check (Let's Encrypt renewal notices)
- `SECRET_KEY` — generate one with `openssl rand -hex 32` and paste the output in
- `POSTGRES_PASSWORD` — a real password, not the default
- `DATABASE_URL` — update the password portion to match `POSTGRES_PASSWORD`
- `INITIAL_ADMIN_USERNAME` / `INITIAL_ADMIN_PASSWORD` — the first admin account; change the
  password immediately after your first login regardless
- `REGISTRATION_INVITE_CODE` — pick something short and easy to say out loud (e.g. a word plus a
  couple of digits). The compose file refuses to start without this being set, since the site is
  now reachable by anyone who finds the URL. Share it with staff verbally or on a staff noticeboard
  — it's a filter against random signups, not a secret that needs encrypting.

`VITE_API_URL` in `.env` is ignored by the production compose file (it always builds the
frontend to call `/api` on the same domain, proxied by Caddy) — no need to touch it.

## 5. Install Docker, lock down the firewall, and start it

**Option A — run the bootstrap script (recommended):**

```bash
sudo ./scripts/bootstrap-server.sh
```

This installs Docker Engine + the Compose plugin (skipped if already installed), configures
`ufw` to only allow SSH/80/443, double-checks none of your `.env` values are still the example
placeholders (and refuses to continue if some are — go fix them and re-run), does a best-effort
check that `DOMAIN` actually resolves to this server, and then runs
`docker compose -f docker-compose.prod.yml up -d --build`. It's safe to re-run any time — each
step checks whether it's already done. Postgres itself needs no separate setup step: the `db`
container creates its role/database from `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` the
first time it starts, the same way every time, so there's nothing to run "as the postgres user"
by hand.

**Option B — do it by hand**, if you'd rather see each step:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Firewall - only SSH, HTTP, HTTPS reachable from the internet
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Build and start everything
docker compose -f docker-compose.prod.yml up -d --build
```

Either way, first run builds the images, starts Postgres, runs the database migrations, seeds
the initial admin account, and asks Caddy to obtain a certificate — give it a minute or two.
Watch progress with:

```bash
docker compose -f docker-compose.prod.yml logs -f
```

(`Ctrl+C` to stop following logs — the containers keep running.)

## 6. Log in

Visit `https://<your-domain>`. Log in with the initial admin account from your `.env`, **change
its password immediately**, then add your tills (Till Session → Manage tills) and approve any
staff accounts as they register.

## Updating the app later

```bash
cd pub-cash-management
git pull                # or re-upload/unzip a new version
docker compose -f docker-compose.prod.yml up -d --build
```

This rebuilds only what changed and restarts those containers; the database volume is untouched.
The backend container runs `alembic upgrade head` on every startup, so any new migrations that
shipped with the update (e.g. new columns or tables) are applied automatically — no manual step
and no volume wipe needed for an additive update like this one.

## Backing up the database

```bash
docker compose -f docker-compose.prod.yml exec db pg_dump -U pubcash pubcash > backup-$(date +%F).sql
```

Copy the resulting `.sql` file off the droplet somewhere safe (e.g. `scp` it to your own
machine) — a droplet backup alone isn't a substitute for keeping a copy elsewhere.

## If the backend keeps restarting with a "type ... already exists" error

Versions of this project before the initial migration was fixed had a bug where it tried to
create each Postgres ENUM type twice in the same migration (once explicitly, once implicitly
via `create_table`) — the second attempt always failed with `DuplicateObject: type "..." already
exists`, on every fresh database, every time. If you're on a build from before that fix, update
to a current copy of the project (the migration file is
`backend/alembic/versions/0001_initial_schema.py`) and reset the database so the corrected
migration runs cleanly:

```bash
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d --build
```

`-v` removes the named volumes (`pubcash_db_data`, plus Caddy's certificate cache) along with
the containers, so this is a genuine "start over" — **only do this if you don't have real cash
data in there yet.** If you do, restoring from a `pg_dump` backup (see above) instead of wiping
is the safe path; ask if you need a hand with that.

If you're already on a current copy and still see this, something else left the database in a
state Alembic doesn't recognize (e.g. manual `psql` changes) — the same reset fixes it for
non-production data.

## If Caddy can't get a certificate ("dial tcp: lookup ... 127.0.0.53:53: connection refused")

This is a common Docker-on-Ubuntu issue, not a DNS/domain problem with your site. On hosts using
`systemd-resolved` (the default on modern Ubuntu), containers can inherit `nameserver 127.0.0.53`
from the host's `/etc/resolv.conf` — a loopback stub resolver address that's meaningless inside a
container's own network namespace, so any external lookup (like reaching Let's Encrypt/ZeroSSL to
get your certificate) fails. `docker-compose.prod.yml` already points the `caddy` service at
public DNS servers (`8.8.8.8`, `1.1.1.1`) to avoid this — if you're on an older copy of the
project without that, update it, then:

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f caddy
```

You should see it obtain a certificate within a few seconds once DNS resolution works.

## Things worth knowing

- **Registration is gated by an invite code**: the register page now also asks for the
  `REGISTRATION_INVITE_CODE` value from your `.env`. Give that code to staff yourself (verbally,
  on a noticeboard, whatever's convenient) — accounts still land as `pending` and need admin
  approval either way, so this is just a filter against random internet strangers filling up
  that queue, not a substitute for the approval step. Rotate it any time by editing `.env` and
  running `docker compose -f docker-compose.prod.yml up -d` again (existing accounts and
  sessions are unaffected — it's only checked at registration time).
- **Restarts on reboot**: all services use `restart: unless-stopped`, and Docker itself starts
  on boot after `get.docker.com`'s install, so the app comes back up automatically if the
  droplet restarts.
- **Rotating `SECRET_KEY`**: changing it invalidates every existing login session (everyone gets
  logged out) — not harmful, just worth doing at a quiet time.
- **Local development is unaffected**: `docker-compose.yml` (no `.prod`) still runs everything
  on `localhost` with published ports, exactly as before, for working on the app on your laptop.
- **Dev and prod now use separate Docker volumes**: both compose files set an explicit project
  `name`, so `docker-compose.yml` and `docker-compose.prod.yml` never accidentally share a
  Postgres volume if both are ever run from the same checkout (they used to default to the same
  project name derived from the directory, which could let dev and prod data collide).
