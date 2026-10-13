#!/usr/bin/env bash
# Sets up a Ripplewise simulation lab on a fresh Ubuntu 24.04 VM: Node 22, PostgreSQL 16 (reachable from the VM only),
# the app as a systemd service, and the browser the agents drive. Run it from inside a clone of the repo, as a normal
# user with sudo:   bash ops/vm/bootstrap.sh
# Safe to run again: it keeps the database password and secrets it already generated.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${ENV_FILE:-/etc/ripplewise.env}"
RUN_USER="$(id -un)"

. /etc/os-release
if [ "${ID:-}" != "ubuntu" ] || [ "${VERSION_ID:-}" != "24.04" ]; then
  echo "This script expects Ubuntu 24.04 (it ships PostgreSQL 16). Found: ${PRETTY_NAME:-unknown}." >&2
  exit 1
fi

echo "==> Packages"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates build-essential openssl postgresql postgresql-contrib

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  echo "==> Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> PostgreSQL"
sudo systemctl enable --now postgresql
if [ ! -f "$ENV_FILE" ]; then
  DB_PASS="$(openssl rand -hex 16)"
  AUTH="$(openssl rand -hex 32)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ripplewise') THEN
    CREATE ROLE ripplewise LOGIN SUPERUSER PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE ripplewise PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'ripplewise'" | grep -q 1 \
    || sudo -u postgres createdb -O ripplewise ripplewise
  sudo install -m 600 -o "$RUN_USER" /dev/null "$ENV_FILE"
  cat > "$ENV_FILE" <<ENVV
DATABASE_URL=postgres://ripplewise:$DB_PASS@localhost:5432/ripplewise
AUTH_SECRET=$AUTH
AUTH_TRUST_HOST=true
APP_URL=http://localhost:3000
# The simulated clock lets an agent act on a past or future day. Keep this VM private (no public firewall rules).
ALLOW_SIM_CLOCK=true
# Events go to RudderStack (and on to BigQuery) when both are set; they are always kept in Postgres too.
RUDDERSTACK_WRITE_KEY=
RUDDERSTACK_DATA_PLANE_URL=
ENVV
  echo "Wrote $ENV_FILE (readable only by $RUN_USER)."
fi

echo "==> Dependencies and browser"
cd "$APP_DIR"
npm ci
npx playwright install --with-deps chromium

echo "==> Tables and build"
set -a
. "$ENV_FILE"
set +a
npm run db:migrate
npm run build

echo "==> App service"
sudo tee /etc/systemd/system/ripplewise.service >/dev/null <<UNIT
[Unit]
Description=Ripplewise app
After=network.target postgresql.service

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable ripplewise
sudo systemctl restart ripplewise

for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:3000/login; then
    echo "The app is up on http://localhost:3000 (this VM only)."
    echo "Next: bash ops/vm/seed.sh small    # then medium or large when you are ready"
    exit 0
  fi
  sleep 2
done
echo "The app did not answer within two minutes. Look at: sudo journalctl -u ripplewise -n 50" >&2
exit 1
