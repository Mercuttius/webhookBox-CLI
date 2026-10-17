import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formula } from '../scripts/prepare-homebrew.js';

test('Homebrew formula binds release version, checksum, runtime and functional test', () => {
  const text = formula({ repository: 'example/webhook-box', version: '0.1.0', filename: 'webhookbox-cli-0.1.0.tgz', sha256: 'a'.repeat(64) });
  assert.ok(text.includes('https://github.com/example/webhook-box/releases/download/v0.1.0/webhookbox-cli-0.1.0.tgz'));
  assert.ok(text.includes(`sha256 "${'a'.repeat(64)}"`));
  assert.ok(text.includes('depends_on "node@24"'));
  assert.ok(text.includes('depends_on "cloudflared"'));
  assert.ok(text.includes('"#{libexec}/bin/webhookbox.js" "$@"'));
  assert.ok(text.includes('box create homebrew-test --json'));
});

test('Homebrew generation rejects missing repository and injectable metadata', () => {
  const valid = { repository: 'example/webhook-box', version: '0.1.0', filename: 'webhookbox-cli-0.1.0.tgz', sha256: 'a'.repeat(64) };
  for (const repository of [undefined, '', 'https://github.com/example/repo', 'x/y"', 'x/y/z']) assert.throws(() => formula({ ...valid, repository }));
  assert.throws(() => formula({ ...valid, version: '0.1.0-beta' }));
  assert.throws(() => formula({ ...valid, sha256: 'invalid' }));
});
