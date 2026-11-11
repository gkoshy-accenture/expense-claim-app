#!/usr/bin/env bash
# One-time setup on the Jenkins VM (Ubuntu 24.04). Run from the deploy/ folder as a sudo-capable user:
#   bash vm-setup.sh
set -euo pipefail

sudo apt update
sudo apt install -y ca-certificates curl gnupg git rsync sqlite3

# Node 22 from NodeSource (the app uses node:sqlite, which needs Node 22.13 or newer).
# Ubuntu's own nodejs package is Node 18, so remove it first if it is installed.
sudo apt purge -y nodejs npm || true
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# App folder (replaced on every deploy) and data folder (kept between deploys).
sudo mkdir -p /opt/demo-app /var/lib/demo-app
sudo chown jenkins:jenkins /opt/demo-app /var/lib/demo-app

sudo cp demo-app.service /etc/systemd/system/demo-app.service
sudo systemctl daemon-reload
sudo systemctl enable demo-app

# Allow the jenkins user to restart ONLY this one service, with no password.
echo 'jenkins ALL=(root) NOPASSWD: /usr/bin/systemctl restart demo-app' | sudo tee /etc/sudoers.d/jenkins-demo-app >/dev/null
sudo chmod 440 /etc/sudoers.d/jenkins-demo-app
sudo visudo -cf /etc/sudoers.d/jenkins-demo-app

# --- Read-only MCP server for the database ---------------------------------
# Runs from its own folder so attendee deploys (which only touch /opt/demo-app) cannot change it.
sudo mkdir -p /opt/mcp-db
sudo cp ../mcp-db/server.js ../mcp-db/package.json /opt/mcp-db/
sudo chown -R jenkins:jenkins /opt/mcp-db
# Install the SQL Server driver. --ignore-scripts stops packages from running code during install.
sudo -u jenkins bash -c 'cd /opt/mcp-db && npm install --omit=dev --ignore-scripts --no-audit --no-fund'

if [ ! -f /etc/mcp-db.env ]; then
  echo "MCP_TOKEN=$(openssl rand -hex 24)" | sudo tee /etc/mcp-db.env >/dev/null
fi
sudo chown root:jenkins /etc/mcp-db.env
sudo chmod 640 /etc/mcp-db.env

sudo cp mcp-db.service /etc/systemd/system/mcp-db.service
sudo systemctl daemon-reload
sudo systemctl enable mcp-db
# It is started after you create /etc/mcp-db.env's DB_* lines and /etc/demo-app.env (see the notes at the end).

# Restart Jenkins so builds see the new Node on their PATH.
sudo systemctl restart jenkins

node --version
echo
echo "Done. Next steps:"
echo "  1. Run deploy/azure-sql-setup.sql once in the Azure portal Query editor (replace the two passwords first)."
echo "  2. Write the database settings (asks for the server, database and the two passwords):  bash configure-db.sh"
echo "  3. Check the VM can reach the database:  nc -vz YOUR-SERVER.database.windows.net 1433"
echo "  4. Run the Jenkins job once, then:  sudo systemctl start mcp-db"
echo "  5. Token for attendees:  sudo grep MCP_TOKEN /etc/mcp-db.env"
