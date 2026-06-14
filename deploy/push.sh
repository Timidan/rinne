#!/usr/bin/env bash
# One-command deploy: rsync this repo to the droplet, rebuild, restart.
#
#   ./deploy/push.sh
#
# The target host is read from deploy/.env (gitignored) or the RINNE_DEPLOY_HOST
# env var, so the origin IP never lands in the committed repo (it stays hidden
# behind Cloudflare). Create deploy/.env with:
#   RINNE_DEPLOY_HOST=your.droplet.ip
#   RINNE_DEPLOY_KEY=~/.ssh/id_ed25519   # optional, this is the default
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[ -f "$ROOT/deploy/.env" ] && source "$ROOT/deploy/.env"

HOST="${RINNE_DEPLOY_HOST:?Set RINNE_DEPLOY_HOST in deploy/.env or the environment}"
KEY="${RINNE_DEPLOY_KEY:-$HOME/.ssh/id_ed25519}"
SSH="ssh -o IdentitiesOnly=yes -i ${KEY/#\~/$HOME}"

echo "→ syncing source to $HOST"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git \
  --exclude 'rinne/artifacts/store' --exclude .codegraph --exclude 'deploy/.env' \
  -e "$SSH" "$ROOT/" "root@$HOST:/opt/rinne/"

echo "→ building + restarting on the droplet"
$SSH "root@$HOST" 'bash -lc "
  set -e
  cd /opt/rinne
  pnpm install --frozen-lockfile
  pnpm --filter rinne-web build
  pnpm --filter rinne build
  systemctl restart rinne
  sleep 2
  systemctl is-active rinne
"'

echo "✓ deployed"
