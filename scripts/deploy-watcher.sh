#!/bin/bash
set -e

LOCKFILE="/tmp/mediapiayer-deploy.lock"
BRANCH="main"
REPO_DIR="/home/pi/mediapiayer"

exec 9>"$LOCKFILE"
if ! flock -n 9; then
  exit 0
fi

cd "$REPO_DIR"

git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date)] New commits detected, deploying..."

CHANGED_FILES=$(git diff --name-only "$LOCAL" "$REMOTE")

git pull origin "$BRANCH"

if echo "$CHANGED_FILES" | grep -qE '^(package(-lock)?\.json|server/)'; then
  npm install
fi

if echo "$CHANGED_FILES" | grep -qE '^frontend/'; then
  (cd frontend && npm install && npm run build)
else
  echo "[$(date)] No frontend changes, skipping rebuild"
fi

sudo systemctl restart mediapiayer.service

# Give the service a moment to come up, then verify it actually started.
# On failure, roll back to the previous known-good commit and rebuild.
sleep 3
if ! systemctl is-active --quiet mediapiayer.service; then
  echo "[$(date)] Service failed to start after deploy, rolling back to $LOCAL"
  git reset --hard "$LOCAL"
  npm install
  (cd frontend && npm install && npm run build)
  sudo systemctl restart mediapiayer.service
  if systemctl is-active --quiet mediapiayer.service; then
    echo "[$(date)] Rollback successful"
  else
    echo "[$(date)] Rollback FAILED — service still not running, manual intervention required"
  fi
  exit 1
fi

echo "[$(date)] Deploy complete"
