#!/usr/bin/env bash
#
# bootstrap-server.sh - one-shot setup for a fresh Ubuntu droplet (DigitalOcean or similar).
#
# Installs Docker, locks down the firewall, and brings up the production stack. Postgres
# needs NO separate setup step of its own: docker-compose.prod.yml runs it in a container
# from the official postgres image, which creates the role/database/extensions itself on
# first boot from the POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB values in your .env.
# There is deliberately no "log in as the postgres user and run psql" step - Docker does
# that initialization for you, every time, identically.
#
# Run this AS ROOT (or with sudo) from the project directory:
#   sudo ./scripts/bootstrap-server.sh
#
# Safe to re-run: each step checks whether it's already done before doing it again.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

log()  { echo -e "\n\033[1;32m==> $*\033[0m"; }
warn() { echo -e "\033[1;33mWARNING: $*\033[0m"; }
die()  { echo -e "\033[1;31mERROR: $*\033[0m" >&2; exit 1; }

if [[ "${EUID}" -ne 0 ]]; then
  die "Run this as root, e.g.: sudo ./scripts/bootstrap-server.sh"
fi

if [[ ! -f "$PROJECT_DIR/docker-compose.prod.yml" ]]; then
  die "docker-compose.prod.yml not found in $PROJECT_DIR - run this from inside the project."
fi

# --- 1. System packages -----------------------------------------------------

log "Updating package index"
apt-get update -y

log "Installing prerequisites (curl, unzip, ufw)"
apt-get install -y curl unzip ufw

# --- 2. Docker ---------------------------------------------------------------

if command -v docker >/dev/null 2>&1; then
  log "Docker is already installed ($(docker --version)), skipping install"
else
  log "Installing Docker Engine + Compose plugin"
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker

if ! docker compose version >/dev/null 2>&1; then
  die "Docker installed, but 'docker compose' plugin isn't available. Check the Docker install output above."
fi

# --- 3. Firewall ---------------------------------------------------------------

log "Configuring firewall (allowing SSH, HTTP, HTTPS only)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable

# --- 4. Environment file ---------------------------------------------------------------

if [[ ! -f "$PROJECT_DIR/.env" ]]; then
  log "No .env found - creating one from .env.example"
  cp .env.example .env
  warn "Edit .env now (DOMAIN, SECRET_KEY, POSTGRES_PASSWORD, INITIAL_ADMIN_PASSWORD,"
  warn "REGISTRATION_INVITE_CODE, CADDY_ACME_EMAIL) then re-run this script."
  exit 0
fi

# Fail loudly on placeholder values rather than silently deploying an insecure instance.
PLACEHOLDER_PAIRS=(
  "SECRET_KEY:change-me-to-a-long-random-string"
  "POSTGRES_PASSWORD:pubcash"
  "INITIAL_ADMIN_PASSWORD:ChangeMe123!"
  "REGISTRATION_INVITE_CODE:change-me-invite-code"
  "DOMAIN:cash.example.com"
)
still_placeholder=()
for pair in "${PLACEHOLDER_PAIRS[@]}"; do
  key="${pair%%:*}"
  placeholder="${pair#*:}"
  current="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2-)"
  if [[ "$current" == "$placeholder" ]]; then
    still_placeholder+=("$key")
  fi
done
if [[ ${#still_placeholder[@]} -gt 0 ]]; then
  warn "These .env values are still the example placeholders: ${still_placeholder[*]}"
  warn "Edit .env with real values before continuing, especially DOMAIN and the secrets."
  die "Refusing to deploy with placeholder values. Run 'vi .env', fix them, then re-run this script."
fi

# --- 5. DNS sanity check (best-effort, non-fatal) ----------------------------

DOMAIN_VALUE="$(grep -E '^DOMAIN=' .env | head -n1 | cut -d= -f2-)"
PUBLIC_IP="$(curl -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
if [[ -n "$DOMAIN_VALUE" && -n "$PUBLIC_IP" ]]; then
  RESOLVED_IP="$(getent hosts "$DOMAIN_VALUE" 2>/dev/null | awk '{print $1}' | head -n1 || true)"
  if [[ -n "$RESOLVED_IP" && "$RESOLVED_IP" != "$PUBLIC_IP" ]]; then
    warn "$DOMAIN_VALUE currently resolves to $RESOLVED_IP, but this server's public IP looks"
    warn "like $PUBLIC_IP. Caddy will fail to get a certificate until the DNS A record points"
    warn "here. Continuing anyway - fix DNS if the HTTPS step below fails."
  elif [[ -z "$RESOLVED_IP" ]]; then
    warn "$DOMAIN_VALUE doesn't resolve to anything yet. Caddy will fail to get a certificate"
    warn "until you add a DNS A record pointing it at $PUBLIC_IP. Continuing anyway."
  fi
fi

# --- 6. Launch -----------------------------------------------------------------

log "Building and starting the stack (this can take a few minutes on first run)"
docker compose -f docker-compose.prod.yml up -d --build

log "Waiting for the backend to finish migrations and seed the admin account..."
sleep 5
docker compose -f docker-compose.prod.yml logs --no-color backend | tail -n 20

log "Done. Visit https://${DOMAIN_VALUE:-<your domain>} once DNS/HTTPS have settled."
echo "Check overall status any time with:"
echo "  docker compose -f docker-compose.prod.yml ps"
echo "Follow logs with:"
echo "  docker compose -f docker-compose.prod.yml logs -f"
