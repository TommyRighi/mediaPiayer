# MediaPiayer

Self-hosted Netflix-like media streaming that runs well on a Raspberry Pi and can be accessed remotely over Tailscale.

## Requirements (all machines)

- Node.js 24 LTS (or newer)
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

2. Install Node.js 24 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
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
NODE_ENV=production
PUBLIC_ORIGIN=https://raspberry.your-tailnet.ts.net
SOCIAL_ENABLED=false
ENABLE_DOWNLOADS=false
PORT=3000
HOST=127.0.0.1
# Comma-separated absolute paths (optional). Defaults to ./media
# MEDIA_DIRS=/mnt/media
# Optional when running in production behind a custom domain
# CORS_ORIGIN=https://your-domain.example
# Optional if using Transmission
# TRANSMISSION_URL=http://user:pass@127.0.0.1:9091/transmission/rpc
EOF
```

`JWT_SECRET` is required and must be at least 32 bytes in production. Create the first administrator locally with `npm run users -- create --email you@example.com --name Admin --role admin`. Registration requires a one-use invitation; there is no automatic first-user administrator. See the [private desktop deployment guide](docs/app-desktop-tailscale.md).

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

1. Install Node.js 24 LTS and Git.
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
https://<raspberry>.<tailnet>.ts.net
```

If MagicDNS is enabled in your tailnet, you can use:

```
https://<raspberry>.<tailnet>.ts.net
```

With `HOST=127.0.0.1`, enable private HTTPS using `sudo tailscale serve --bg 3000` and use the exact URL shown by `tailscale serve status`. Set `PUBLIC_ORIGIN` to that origin. No router port forwarding is required. Never use Funnel for private sharing.

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

## Playback-first operation on small Raspberry Pi hosts

Keep conversion enabled. The server runs one managed media process at a time,
with CPU nice level 19 and Linux idle I/O priority when `ionice` is available.
Video conversion, subtitle extraction, and YouTube audio processing share this
queue. On POSIX hosts the process group is stopped during playback and resumed
when playback ends. Playback heartbeats cover buffered video, music, and watch
parties; disconnected clients expire after 75 seconds. Ordinary browsing defers
work for 10 seconds, and streaming requests for 30 seconds.

Preparation also waits when available RAM falls below 80 MiB or the reported
CPU temperature reaches 75°C. Suspended processes retain their memory. These
checks reduce contention; they cannot guarantee smooth playback on every Wi-Fi
connection or prevent every out-of-memory condition. Verify actual bitrate,
CPU load, RAM, and temperature on the target Pi. Native Windows process
suspension is not supported.

Low-memory hosts use one video rendition and one software encoder thread.
Compatible files still stream directly. Hardware encoders are tested lazily;
unsupported encoders fall back to software. Interrupted conversions are picked
up at the next server start. The transcode CLI queues conversions for the running
server, which checks for newly queued work every 30 seconds.

Build on a more capable machine where possible. The frontend build emits gzip
and Brotli assets, served without runtime compression. Pages and video libraries
load on demand; the video catalog loads 36 titles at a time. Playback progress
is saved every 20 seconds and on pause/end, and user presence at most once a
minute per user. Music uploads stream to disk instead of buffering whole files.

The original Pi Zero W uses ARMv6: normal modern Node.js distribution binaries
are not compatible with it. A compatible runtime and native dependencies are
still required. These application optimizations do not change that requirement.

## Regression checks

Use a supported Node.js version on the development machine, with native modules
installed for that version. `npm test` uses Node's built-in test runner, isolated
temporary SQLite databases, and scheduler fixtures. `npm run build` checks the
production bundle; run `npm run lint` from `frontend/` for the frontend checks.
`DATABASE_PATH` can override the database location for isolated local validation.

## Desktop app with built-in Tailscale

Friends install one app for Windows or macOS. Electron includes a Go/tsnet helper;
Tailscale is used only by the app. First launch accepts the Pi's private HTTPS
`.ts.net` address and a one-use enrollment key, or opens the official Tailscale login.
The app keeps the node identity encrypted using an OS-protected key and opens the
existing frontend through a capability-protected loopback proxy.

See [setup, invitations, builds and security limits](docs/app-desktop-tailscale.md).
Desktop dependencies are separate: `npm ci --prefix desktop`.
Go 1.26+ is required to compile the helper. Run `npm run helper:build --prefix desktop`,
then `npm run desktop:start`. Build installers with `npm run desktop:build`.

Sessions use HttpOnly cookies; logout revokes them on the server. Viewing history
is off by default, with explicit opt-in in Profile. Social features and downloaders
are off by default. Existing progress and backups are not automatically destroyed.
The Node test suite is available with `npm test`; frontend lint runs in `frontend/`.

### Interface features

The sidebar includes Calendar. Enable shared screenings and watch parties in
**Settings** with an administrator account. These settings are stored in SQLite
and override the initial `SOCIAL_ENABLED` and `ENABLE_DOWNLOADS` environment values.
Viewing history remains a separate personal preference under Profile.

Administrators can use **Music → Manage Music** to create and edit albums, upload
audio, edit track metadata and remove library entries. Playlist tracks can be
reordered with the up/down buttons, and Music offers a random mix.

**Downloads** shows video downloads and YouTube music imports. Enable downloads
in Settings and configure Transmission or install yt-dlp before importing.
Upload, Admin, Settings, Downloads and Manage Music require an administrator;
creating an account with an invite gives viewer access.

My List saves movies and series separately for each account and is independent of
viewing history. Use the + button on library cards or the My List button in details.
Administrators can select **Upload cover** or **Cover from video frame** in details.
Frame capture uses the browser video decoder, then opens the image crop editor;
HLS and series episode selection are supported. If a video cannot be decoded in
the browser, upload an image instead. Image replacement regenerates thumbnails.


### Administrator torrent downloads

Only administrators can start, inspect or cancel torrent jobs. Open **Downloads**,
enter a movie title and magnet link, then start. Viewers can watch after the entire
download and import finish. If conversion is required, playback waits for it too.
Imports currently support one movie per torrent, selecting its largest complete
video file. Season packs and `.torrent` uploads are not supported by this form.

For local OrbStack setup, configure these values in the gitignored `.env`:

```dotenv
TRANSMISSION_USER=mediapiayer
TRANSMISSION_PASSWORD=use-a-long-random-password
TRANSMISSION_UID=501
TRANSMISSION_GID=20
TRANSMISSION_DOWNLOAD_DIR=/absolute/path/to/mediaPiayer/media/.downloads
TRANSMISSION_URL=http://mediapiayer:use-a-long-random-password@127.0.0.1:9091/transmission/rpc
```

Use your machine's UID/GID from `id -u` and `id -g`. For URL credentials, encode
special characters. Start `docker compose -f compose.transmission.yml up -d`,
restart the backend, and enable Downloads in administrator Settings. The daemon
RPC port is bound to localhost. The host and container use the same absolute
folder path, with a separate subfolder per job. Stop the daemon with
`docker compose -f compose.transmission.yml down`.
