import test from 'node:test';
import assert from 'node:assert/strict';

test('service worker serializes popup writes, rejects outsiders, and reports storage failures', async () => {
  const listeners = {}, badge = {}, data = {};
  let failWrites = false;
  globalThis.chrome = {
    runtime: {
      id: 'little-list-test',
      onMessage: { addListener(fn) { listeners.message = fn; } },
      onInstalled: { addListener(fn) { listeners.installed = fn; } },
      onStartup: { addListener(fn) { listeners.startup = fn; } }
    },
    action: {
      async setBadgeText(value) { badge.text = value.text; },
      async setBadgeBackgroundColor(value) { badge.color = value.color; },
      async setTitle(value) { badge.title = value.title; }
    },
    storage: {
      onChanged: { addListener(fn) { listeners.changed = fn; } },
      sync: {
        async get() { return structuredClone(data); },
        async set(values) {
          await new Promise(resolve => setTimeout(resolve, 2));
          if (failWrites) throw new Error('QUOTA_BYTES exceeded');
          Object.assign(data, values);
        },
        async remove(keys) { for (const key of [keys].flat()) delete data[key]; }
      }
    }
  };
  await import('../background.js');
  const send = command => new Promise(resolve => {
    assert.equal(listeners.message({ target: 'little-list', command }, { id: chrome.runtime.id }, resolve), true);
  });
  assert.equal(listeners.message({ target: 'little-list', command: { type: 'list' } }, { id: 'outsider' }, () => assert.fail()), undefined);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => send({ type: 'add', text: `Task ${i}` })));
  assert.deepEqual(results.map(result => result.tasks.length), [1, 2, 3, 4, 5]);
  assert.ok(results.every(result => result.ok));
  failWrites = true;
  const failure = await send({ type: 'add', text: 'Must not disappear' });
  assert.equal(failure.ok, false);
  assert.match(failure.error, /sync limit/);
  failWrites = false;
  assert.equal((await send({ type: 'add', text: 'Recovered' })).tasks.length, 6);
  listeners.changed({}, 'sync');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(badge, { text: '6', color: '#276747', title: 'Little List · 6 left to do' });
  delete globalThis.chrome;
});
