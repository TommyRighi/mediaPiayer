# MediaPiayer

Self-hosted Netflix-like media streaming that runs well on a Raspberry Pi and can be accessed remotely over Tailscale.

## Requirements (all machines)

- Node.js 20 LTS (or newer)
- npm
- Git
- Build tools for native modules (better-sqlite3, sharp)
- Optional: ffmpeg + ffprobe (needed for transcoding, HLS output, subtitles/audio extraction)
- Optional: transmission-daemon (needed for magnet downloads)
- Tailscale (for remote access outside home)

## Raspberry Pi setup (Raspberry Pi OS Lite)

1. Install system packages:

```bash
sudo apt update
sudo apt install -y git build-essential python3 pkg-config \
  libsqlite3-dev libvips-dev ffmpeg
```

2. Install Node.js 20 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

3. Clone the repo and install dependencies:

```bash
git clone https://github.com/TommyRighi/mediaPiayer.git
cd mediaPiayer
npm install
cd frontend && npm install
```

4. Create `.env` in the repo root:

```bash
cat > .env <<'EOF'
JWT_SECRET=replace-with-a-long-random-string
ADMIN_INVITE_CODE=optional-admin-code
PORT=3000
HOST=0.0.0.0
# Comma-separated absolute paths (optional). Defaults to ./media
# MEDIA_DIRS=/mnt/media
# Optional when running in production behind a custom domain
# CORS_ORIGIN=https://your-domain.example
# Optional if using Transmission
# TRANSMISSION_URL=http://user:pass@127.0.0.1:9091/transmission/rpc
EOF
```

`JWT_SECRET` is required. If `ADMIN_INVITE_CODE` is empty, the first registered user becomes admin.

5. Ensure media directories exist (default):

```bash
mkdir -p media/movies media/series media/posters media/music
```

6. Build and run (production):

```bash
npm run build
npm start
```

The database is created automatically at `data/mediapiayer.db`.

## General machine setup (macOS/Linux/Windows)

1. Install Node.js 20 LTS and Git.
2. Install build tools for native modules:

Linux:

```bash
sudo apt update
sudo apt install -y build-essential python3 pkg-config libsqlite3-dev libvips-dev
```

macOS:

```bash
xcode-select --install
brew install vips sqlite
```

Windows:

- Install Node.js (includes npm).
- Install "Build Tools for Visual Studio" and Python 3.

3. Install optional media tools (if you want transcoding/HLS and track extraction):

Linux:

```bash
sudo apt install -y ffmpeg
```

macOS:

```bash
brew install ffmpeg
```

Windows:

- Install ffmpeg and ensure it is on PATH.

4. Clone and install dependencies:

```bash
git clone https://github.com/TommyRighi/mediaPiayer.git
cd mediaPiayer
npm install
cd frontend && npm install
```

5. Create `.env` as shown in the Raspberry Pi section.

6. Run in dev mode (two terminals):

```bash
# Terminal 1 (backend)
npm run dev
```

```bash
# Terminal 2 (frontend)
cd frontend
npm run dev
```

Vite runs on `http://localhost:5173` and proxies `/api` to the backend on port 3000.

7. Build and run (production):

```bash
npm run build
npm start
```

## Tailscale setup (watch outside home)

1. Install Tailscale on the Raspberry Pi:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname mediapiayer
```

2. Install Tailscale on your laptop/phone and sign in to the same tailnet.
3. Get the Pi's Tailscale IP:

```bash
tailscale ip -4
```

4. Open the app from any device on the tailnet:

```
http://<tailscale-ip>:3000
```

If MagicDNS is enabled in your tailnet, you can use:

```
http://mediapiayer:3000
```

No router port forwarding is required.

## Optional SSH menu

The repository includes `setup-ssh-menu.sh` for creating a local terminal menu helper:

```bash
./setup-ssh-menu.sh
./ssh-menu.sh
```

By default, this only writes helper scripts inside the project directory and does not modify shell startup files. To auto-launch the menu for interactive SSH sessions, opt in explicitly:

```bash
./setup-ssh-menu.sh --install-shell-hook
```

The opt-in shell hook adds a marked block to `~/.bashrc`.

## Publishing

Before making the repository public or cutting a release, run through [the safe release checklist](docs/safe-release-checklist.md).

## Optional: Transmission (magnet downloads)

On the Raspberry Pi:

```bash
sudo apt install -y transmission-daemon
```

Edit `/etc/transmission-daemon/settings.json`:

- Set `"rpc-bind-address": "127.0.0.1"`
- Set `"rpc-username"` and `"rpc-password"`
- Set `"download-dir"` to a folder under your media path (for example `media/.downloads/`)
- Set `"rpc-whitelist-enabled": false`
- Set `"seed-queue-enabled": true` and `"seed-queue-size": 0`

Restart the service:

```bash
sudo systemctl restart transmission-daemon
```

Then set this in `.env`:

```
TRANSMISSION_URL=http://user:pass@127.0.0.1:9091/transmission/rpc
```
