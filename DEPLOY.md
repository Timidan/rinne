# Deploying Rinne to a droplet

Rinne is **one Node service**. It serves the guard API (`/v1`, `/api`), the
agent skill (`/skill.md`), and the dashboard (`/app`) on a single origin. No
database, no Redis, no queue — state is the file-backed store at
`rinne/artifacts/store/*.json`, which lives on the droplet's own disk.

Production shape: the Node process listens on `127.0.0.1:4517`; **nginx** sits in
front for TLS; **systemd** keeps the process alive and restarts it on reboot.

```
agent ──https──▶ nginx (443, TLS) ──http──▶ node :4517 (loopback) ──▶ Surf / Nansen
                                                  │
                                          artifacts/store/*.json  (on disk)
```

## 0. Before you start

- A droplet running Ubuntu 22.04+ (1 vCPU / 1 GB is plenty).
- A domain with an **A record** pointing at the droplet's IP.
- Provider keys: **`SURF_API_KEY`** (Surf now requires a paid key — it returns
  HTTP 402 without one) and **`NANSEN_API_KEY`**. Without these the guard can
  only ever return `review` for anything needing live evidence.

## 1. Install the runtime

```bash
# Node 20+ (nodesource), pnpm via corepack, nginx, certbot
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo corepack enable
sudo snap install --classic certbot && sudo ln -sf /snap/bin/certbot /usr/bin/certbot
```

## 2. Get the code and build

The whole repo must be deployed (the server resolves `../rinne-web/dist` and
`../docs/agents/SKILL.md` relative to the `rinne` package), so keep the layout.

This repo has no git remote yet, so use **one** of:

```bash
# Option A — rsync from your local machine (no GitHub needed). Run locally:
rsync -az --delete \
  --exclude node_modules --exclude '**/dist' --exclude 'rinne/artifacts/store' \
  /path/to/rinne/ root@YOUR_DROPLET:/opt/rinne/

# Option B — if you push the repo to GitHub first, on the droplet:
# sudo git clone https://github.com/<you>/rinne /opt/rinne
```

Then build on the droplet:

```bash
cd /opt/rinne
pnpm install --frozen-lockfile
pnpm --filter rinne-web build   # builds the dashboard into rinne-web/dist
pnpm --filter rinne build       # compiles the server/CLI into rinne/dist
```

## 3. Create the service user and the writable store

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin rinne
sudo mkdir -p /opt/rinne/rinne/artifacts/store
sudo chown -R rinne:rinne /opt/rinne/rinne/artifacts
```

The store is the **only** path the service writes to; everything else runs
read-only under systemd hardening.

## 4. Environment

```bash
sudo cp /opt/rinne/deploy/rinne.env.example /etc/rinne.env
sudo nano /etc/rinne.env      # fill in SURF_API_KEY + NANSEN_API_KEY
sudo chmod 600 /etc/rinne.env
sudo chown root:root /etc/rinne.env
```

## 5. systemd

```bash
sudo cp /opt/rinne/deploy/rinne.service /etc/systemd/system/rinne.service
# If `which node` is not /usr/bin/node, fix ExecStart in the unit first.
sudo systemctl daemon-reload
sudo systemctl enable --now rinne
systemctl status rinne --no-pager
journalctl -u rinne -n 40 --no-pager     # should print the dashboard/skill URLs
```

A quick loopback smoke test before exposing it:

```bash
curl -s http://127.0.0.1:4517/api/doctor | head
```

## 6. nginx + TLS

```bash
sudo cp /opt/rinne/deploy/nginx-rinne.conf /etc/nginx/sites-available/rinne
sudo sed -i 's/rinne.example.com/YOUR_DOMAIN/g' /etc/nginx/sites-available/rinne
sudo ln -sf /etc/nginx/sites-available/rinne /etc/nginx/sites-enabled/rinne
sudo rm -f /etc/nginx/sites-enabled/default
sudo certbot --nginx -d YOUR_DOMAIN     # provisions + wires the cert
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Port 4517 is **never** opened — the guard is reachable only through nginx.

## 8. Verify the deploy

```bash
# The served skill must show YOUR https domain in every curl example:
curl -s https://YOUR_DOMAIN/skill.md | grep RINNE_BASE_URL -n | head
```

Then in a browser:
1. Open `https://YOUR_DOMAIN/app` — the dashboard loads (overview + agents).
2. Register a real agent against `https://YOUR_DOMAIN` per `/skill.md`, send a
   `/v1/guard` call, and confirm the decision appears in the dashboard.

## Updating

```bash
cd /opt/rinne && sudo git pull
pnpm install --frozen-lockfile
pnpm --filter rinne-web build && pnpm --filter rinne build
sudo systemctl restart rinne
```

## Operations

- **Logs:** `journalctl -u rinne -f`
- **Backups:** the entire state is `/opt/rinne/rinne/artifacts/store/*.json` —
  registered agents (API-key *hashes* only) and decision history. Snapshot the
  droplet volume or copy that directory.
- **Health check:** `GET /api/doctor` (or `GET /skill.md`) returns 200.
- **Secrets:** only `/etc/rinne.env` holds secrets. Keys are never logged or
  returned in API responses; agent API keys are stored as hashes.
- **Scaling:** this is a single stateful instance. Running more than one
  replica would need the file store replaced with a shared database first — out
  of scope for the current deploy.
