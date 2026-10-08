const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateTarget, validateAuthKey, validAuthURL } = require('../validation.cjs');
test('enrollment accepts only fixed HTTPS tailnet targets', () => {
  assert.equal(validateTarget('https://pi.tail.ts.net/'),'https://pi.tail.ts.net');
  for (const target of ['http://pi.tail.ts.net','https://pi.tail.ts.net.evil.com','https://pi.tail.ts.net/path','https://a:b@pi.tail.ts.net','https://pi.tail.ts.net?authkey=secret']) assert.throws(() => validateTarget(target));
});
test('login URLs and keys cannot invoke arbitrary protocols or shells', () => {
  assert.equal(validAuthURL('https://login.tailscale.com/a/123'),true);
  assert.equal(validAuthURL('https://login.tailscale.com.evil.com/a'),false);
  assert.equal(validAuthURL('file:///tmp/evil'),false);
  assert.equal(validateAuthKey('tskey-auth-example-123'),'tskey-auth-example-123');
  assert.throws(() => validateAuthKey('tskey-auth-$(command)'));
});
