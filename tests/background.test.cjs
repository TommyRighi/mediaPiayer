const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

function fixture() {
  let now = 100000;
  let memory = 200 * 1024 ** 2;
  let temperature = 45;
  let tick;
  const signals = [];
  const child = new EventEmitter(); child.pid = 123;
  child.kill = signal => { signals.push(signal); return true; };
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../server/background'), 'utf8'), {
    module: mod,
    require(name) {
      if (name === 'os') return { totalmem: () => 512 * 1024 ** 2, freemem: () => memory, cpus: () => [{}], setPriority() {} };
      if (name === 'fs') return { readFileSync: file => file.includes('meminfo') ? `MemAvailable: ${memory / 1024}` : String(temperature * 1000) };
      if (name === 'child_process') return { spawn: () => child, execFile: (...args) => args.at(-1)() };
      throw Error(name);
    },
    Date: { now: () => now },
    process: { platform: 'linux', kill: (_pid, signal) => { signals.push(signal); } },
    setInterval: fn => { tick = fn; return { unref() {} }; }, clearInterval() {}, setTimeout,
  });
  return { scheduler: mod.exports, child, signals, advance(ms) { now += ms; tick(); }, memory(value) { memory = value; tick(); }, temperature(value) { temperature = value; tick(); } };
}

test('encoding pauses for playback, then resumes; stale sessions expire', async () => {
  const f = fixture(); await f.scheduler.spawnBackground('ffmpeg', []); f.child.emit('spawn');
  f.scheduler.playback('user', 'one', true);
  assert.equal(f.signals.at(-1), 'SIGSTOP');
  f.scheduler.playback('user', 'two', true);
  f.scheduler.playback('user', 'one', false);
  assert.equal(f.scheduler.pauseReason(), 'playback');
  f.advance(76000);
  assert.equal(f.signals.at(-1), 'SIGCONT');
  assert.equal(f.scheduler.pauseReason(), null);
});

test('activity, low memory and temperature pause work until resources recover', async () => {
  const f = fixture(); await f.scheduler.spawnBackground('ffmpeg', []);
  f.scheduler.touchActivity(); assert.equal(f.scheduler.pauseReason(), 'activity');
  f.advance(11000); assert.equal(f.signals.at(-1), 'SIGCONT');
  f.memory(60 * 1024 ** 2); assert.equal(f.scheduler.pauseReason(), 'memory');
  assert.equal(f.signals.at(-1), 'SIGSTOP');
  f.memory(200 * 1024 ** 2); assert.equal(f.signals.at(-1), 'SIGCONT');
  f.temperature(80); assert.equal(f.scheduler.pauseReason(), 'temperature');
  f.scheduler.shutdown(); assert.deepEqual(f.signals.slice(-2), ['SIGCONT', 'SIGTERM']);
});
