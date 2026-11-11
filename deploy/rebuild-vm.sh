#!/usr/bin/env bash
# Rebuild the workshop VM from scratch (Ubuntu 24.04 LTS). Run from this deploy/ folder as a sudo-capable user:
#   bash rebuild-vm.sh your-label.swedencentral.cloudapp.azure.com
# Installs Java + Jenkins, Caddy (HTTPS), then runs vm-setup.sh (Node 22, app and MCP services).
set -euo pipefail

HOST="${1:?Usage: bash rebuild-vm.sh <public-hostname>   e.g. my-label.swedencentral.cloudapp.azure.com}"
cd "$(dirname "$0")"

echo "== Java and Jenkins =="
sudo apt update
sudo apt install -y fontconfig openjdk-21-jre wget
sudo mkdir -p /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" | sudo tee /etc/apt/sources.list.d/jenkins.list >/dev/null
sudo apt update
sudo apt install -y jenkins
sudo systemctl enable --now jenkins

echo "== Caddy =="
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt update
sudo apt install -y caddy
sed "s/YOUR-HOSTNAME/${HOST}/" Caddyfile.example | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl restart caddy

echo "== Node, app service, MCP service =="
bash vm-setup.sh

echo
echo "== Jenkins first-run password =="
sudo cat /var/lib/jenkins/secrets/initialAdminPassword || echo "(Jenkins is still starting; run this again in a minute)"
echo "Open https://${HOST} to finish the Jenkins setup."
