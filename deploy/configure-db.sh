#!/usr/bin/env bash
# Writes the Azure SQL connection settings for the app and the MCP server, then restarts them.
# Run on the VM, from this deploy/ folder:   bash configure-db.sh
# Passwords are typed silently, so they do not appear on screen or in your shell history.
set -euo pipefail

ETC_DIR="${ETC_DIR:-/etc}"          # override only for testing
SUDO=""; [ "$ETC_DIR" = "/etc" ] && SUDO="sudo"

ask() { # ask VAR "Prompt" [default]
  local var="$1" prompt="$2" default="${3:-}" value
  if [ -n "$default" ]; then read -r -p "$prompt [$default]: " value; value="${value:-$default}"
  else read -r -p "$prompt: " value; fi
  printf -v "$var" '%s' "$value"
}
ask_secret() { # ask_secret VAR "Prompt"
  local var="$1" prompt="$2" value
  read -r -s -p "$prompt: " value; echo
  [ -n "$value" ] || { echo "A password is required." >&2; exit 1; }
  case "$value" in *[[:space:]\'\"\\\$\`]*) echo "Use a password without spaces or the characters ' \" \\ \$ \` (they break env files). Change it in the portal with ALTER USER and try again." >&2; exit 1;; esac
  printf -v "$var" '%s' "$value"
}

ask DB_SERVER "Azure SQL server (for example myserver.database.windows.net)"
case "$DB_SERVER" in *.database.windows.net) ;; *) echo "That does not look like an Azure SQL server name." >&2; exit 1;; esac
ask DB_NAME "Database name" "expense-claims-db"
ask APP_USER "App login (read/write)" "app_user"
ask_secret APP_PASSWORD "Password for $APP_USER"
ask MCP_USER "MCP login (read-only)" "mcp_reader"
ask_secret MCP_PASSWORD "Password for $MCP_USER"

APP_ENV="$ETC_DIR/demo-app.env"
MCP_ENV="$ETC_DIR/mcp-db.env"

# App settings
$SUDO tee "$APP_ENV" >/dev/null <<ENV
DB_SERVER=$DB_SERVER
DB_PORT=1433
DB_NAME=$DB_NAME
DB_USER=$APP_USER
DB_PASSWORD=$APP_PASSWORD
DB_ENCRYPT=true
ENV

# MCP settings: keep the existing token, or create one
TOKEN=""
if $SUDO test -f "$MCP_ENV"; then TOKEN="$($SUDO grep -E '^MCP_TOKEN=' "$MCP_ENV" | head -n1 | cut -d= -f2- || true)"; fi
[ -n "$TOKEN" ] || TOKEN="$(openssl rand -hex 24)"
$SUDO tee "$MCP_ENV" >/dev/null <<ENV
MCP_TOKEN=$TOKEN
DB_SERVER=$DB_SERVER
DB_PORT=1433
DB_NAME=$DB_NAME
DB_USER=$MCP_USER
DB_PASSWORD=$MCP_PASSWORD
DB_ENCRYPT=true
ENV

if [ -z "${SKIP_SERVICES:-}" ]; then
  $SUDO chown root:jenkins "$APP_ENV" "$MCP_ENV"
  $SUDO chmod 640 "$APP_ENV" "$MCP_ENV"
  echo
  echo "Checking that this VM can reach the database (the first connection can take a minute if it was paused)..."
  if command -v nc >/dev/null && nc -z -w 10 "$DB_SERVER" 1433; then echo "  Network path OK."
  else echo "  Could not reach $DB_SERVER:1433. Add this VM's public IP to the SQL server's firewall (Networking) and retry." >&2; fi
  for svc in demo-app mcp-db; do
    if systemctl list-unit-files | grep -q "^$svc.service"; then
      $SUDO systemctl restart "$svc" && echo "  Restarted $svc."
    else
      echo "  $svc service not installed yet (run vm-setup.sh, then the Jenkins job)."
    fi
  done
  echo
  echo "Done. Check the app:  curl -s http://127.0.0.1:3000/health/db"
  echo "MCP token for attendees:  sudo grep MCP_TOKEN $MCP_ENV"
else
  chmod 640 "$APP_ENV" "$MCP_ENV"
fi
