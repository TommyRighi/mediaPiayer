// Cooperative scheduling for expensive media work. Playback leases also cover
// time spent playing buffered media, when there are no HTTP streaming requests.
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const constrained = os.totalmem() <= 2 * 1024 ** 3 || os.cpus().length === 1;
const sessions = new Map();
const children = new Map();
let busyUntil = 0;
let resourceReason = null;
let monitor;
let shuttingDown = false;

function pauseReason() {
  const now = Date.now();
  for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
  if (sessions.size) return 'playback';
  if (busyUntil > now) return 'activity';
  return resourceReason;
}

function signalChild(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try { process.kill(-child.pid, signal); return true; } catch { /* Already exited, or group unavailable. */ }
  }
  return child.kill(signal);
}

function reconcile() {
  const reason = pauseReason();
  for (const [child, paused] of children) {
    if (!!reason === paused || process.platform === 'win32') continue;
    try {
      if (signalChild(child, reason ? 'SIGSTOP' : 'SIGCONT')) children.set(child, !!reason);
    } catch { /* Process already exited. */ }
  }
}

function touchActivity(ms = 10000) {
  busyUntil = Math.max(busyUntil, Date.now() + ms);
  reconcile();
}

function playback(userId, sessionId, active) {
  const key = `${userId}:${sessionId}`;
  if (active) sessions.set(key, Date.now() + 75000);
  else sessions.delete(key);
  reconcile();
}

function sampleResources() {
  let available = os.freemem();
  try {
    // Linux freemem excludes reclaimable page cache, MemAvailable does not.
    const match = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m);
    if (match) available = Number(match[1]) * 1024;
  } catch { /* Non-Linux host. */ }
  resourceReason = available < 80 * 1024 ** 2 ? 'memory' : null;
  try {
    const temperature = Number(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000;
    if (temperature >= 75) resourceReason = 'temperature';
  } catch { /* No thermal sensor. */ }
  reconcile();
}

function startMonitor() {
  if (monitor) return;
  sampleResources();
  monitor = setInterval(sampleResources, 3000);
  monitor.unref();
}

async function waitForIdle() {
  startMonitor();
  while (pauseReason()) {
    if (shuttingDown) throw new Error('Server is shutting down');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (shuttingDown) throw new Error('Server is shutting down');
}

async function spawnBackground(command, args) {
  for (;;) {
    await waitForIdle();
    if (children.size === 0) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const child = spawn(command, args, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
  children.set(child, false);
  child.once('spawn', () => {
    try { os.setPriority(child.pid, 19); } catch { /* Best effort on non-POSIX hosts. */ }
    if (process.platform === 'linux') {
      execFile('ionice', ['-c', '3', '-p', String(child.pid)], () => {});
    }
    reconcile();
  });
  const remove = () => children.delete(child);
  child.once('close', remove);
  child.once('error', remove);
  return child;
}

function shutdown() {
  shuttingDown = true;
  clearInterval(monitor);
  for (const child of children.keys()) {
    try {
      if (process.platform !== 'win32') signalChild(child, 'SIGCONT');
      signalChild(child, 'SIGTERM');
    } catch { /* Already exited. */ }
  }
}

module.exports = { isShuttingDown: () => shuttingDown, constrained, pauseReason, touchActivity, playback, waitForIdle, spawnBackground, shutdown };
