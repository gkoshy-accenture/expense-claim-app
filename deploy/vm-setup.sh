#!/usr/bin/env bash
# One-time setup on the Jenkins VM (Ubuntu 24.04). Run as a sudo-capable user:
#   bash vm-setup.sh
set -euo pipefail

sudo apt update
sudo apt install -y nodejs npm git rsync curl

sudo mkdir -p /opt/demo-app
sudo chown jenkins:jenkins /opt/demo-app

sudo cp demo-app.service /etc/systemd/system/demo-app.service
sudo systemctl daemon-reload
sudo systemctl enable demo-app

# Allow the jenkins user to restart ONLY this one service, with no password.
echo 'jenkins ALL=(root) NOPASSWD: /usr/bin/systemctl restart demo-app' | sudo tee /etc/sudoers.d/jenkins-demo-app >/dev/null
sudo chmod 440 /etc/sudoers.d/jenkins-demo-app
sudo visudo -cf /etc/sudoers.d/jenkins-demo-app

node --version
echo "Done. The first Jenkins deploy will copy the app to /opt/demo-app and start the service."
