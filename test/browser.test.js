import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';

const { openBrowser } = await import('../src/util/browser.js');

function createFakeSpawn(failingCommands = new Set()) {
  const recorded = [];
  const spawnImpl = (command, args, options) => {
    recorded.push(command);
    const ee = new EventEmitter();
    ee.unref = () => {};
    setImmediate(() => {
      if (failingCommands.has(command)) {
        ee.emit('error', new Error(`Command failed: ${command}`));
      } else {
        ee.emit('spawn');
      }
    });
    return ee;
  };
  return { spawnImpl, recorded };
}

test('linux platform, xdg-open fails and gio succeeds -> resolves true and the recorded commands are [xdg-open, gio]', async () => {
  const { spawnImpl, recorded } = createFakeSpawn(new Set(['xdg-open']));
  const result = await openBrowser('https://example.com', {
    platform: 'linux',
    env: {},
    spawnImpl,
  });
  assert.equal(result, true);
  assert.deepEqual(recorded, ['xdg-open', 'gio']);
});

test('linux, both fail -> resolves false', async () => {
  const { spawnImpl, recorded } = createFakeSpawn(new Set(['xdg-open', 'gio']));
  const result = await openBrowser('https://example.com', {
    platform: 'linux',
    env: {},
    spawnImpl,
  });
  assert.equal(result, false);
  assert.deepEqual(recorded, ['xdg-open', 'gio']);
});

test('darwin, open succeeds -> true and commands are [open]', async () => {
  const { spawnImpl, recorded } = createFakeSpawn(new Set());
  const result = await openBrowser('https://example.com', {
    platform: 'darwin',
    env: {},
    spawnImpl,
  });
  assert.equal(result, true);
  assert.deepEqual(recorded, ['open']);
});
