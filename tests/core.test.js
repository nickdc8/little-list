import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCommand, readTasks, PREFIX } from '../core.js';

function memory(initial = {}) {
  let data = structuredClone(initial);
  return {
    async get() { return structuredClone(data); },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of [keys].flat()) delete data[key]; }
  };
}
const entry = (id, text = id, done = false, createdAt = 1) => ({ id, text, done, createdAt });

test('add, edit, complete, reopen, and delete persist across sessions', async () => {
  const store = memory();
  const [task] = await handleCommand(store, { type: 'add', text: '  Pick up coffee  ' });
  assert.equal(task.text, 'Pick up coffee');
  assert.equal(task.done, false);
  await handleCommand(store, { type: 'edit', id: task.id, text: 'Pick up tea' });
  await handleCommand(store, { type: 'toggle', id: task.id, done: true });
  assert.deepEqual((await handleCommand(store, { type: 'list' }))[0], { ...task, text: 'Pick up tea', done: true });
  assert.equal((await handleCommand(store, { type: 'toggle', id: task.id, done: false }))[0].done, false);
  assert.deepEqual(await handleCommand(store, { type: 'delete', id: task.id }), []);
});

test('edits preserve unrelated tasks arriving from another computer', async () => {
  const store = memory({ [PREFIX + 'a']: entry('a') });
  await handleCommand(store, { type: 'list' });
  await store.set({ [PREFIX + 'remote']: entry('remote') });
  const result = await handleCommand(store, { type: 'edit', id: 'a', text: 'Changed locally' });
  assert.equal(result.length, 2);
  assert.equal(result.find(t => t.id === 'remote').text, 'remote');
});

test('clear completed preserves active tasks and unrelated settings', async () => {
  const store = memory({ [PREFIX + 'a']: entry('a'), [PREFIX + 'b']: entry('b', 'Done', true), setting: 'keep' });
  const tasks = await handleCommand(store, { type: 'clearDone' });
  assert.deepEqual(tasks.map(t => t.id), ['a']);
  assert.equal((await store.get()).setting, 'keep');
});

test('validates input and leaves stored data unchanged on failures', async () => {
  const store = memory();
  for (const text of ['', '   ', 'x'.repeat(241), null, 44]) {
    await assert.rejects(handleCommand(store, { type: 'add', text }));
  }
  assert.deepEqual(await store.get(), {});
  await assert.rejects(handleCommand(store, { type: 'surprise' }), /Unknown action/);
});

test('a stale edit cannot recreate a task deleted on another device', async () => {
  await assert.rejects(handleCommand(memory(), { type: 'edit', id: 'gone', text: 'Again' }), /removed on another device/);
});

test('sync quota errors propagate without pretending a change saved', async () => {
  const store = memory();
  store.set = async () => { throw new Error('QUOTA_BYTES exceeded'); };
  await assert.rejects(handleCommand(store, { type: 'add', text: 'Important' }), /QUOTA_BYTES/);
  assert.deepEqual(await store.get(), {});
});

test('sorts unfinished tasks first, newest first, and ignores invalid sync records', () => {
  const tasks = readTasks({ [PREFIX + 'a']: entry('a', 'Old', false, 1), [PREFIX + 'b']: entry('b', 'New', false, 2), [PREFIX + 'c']: entry('c', 'Done', true, 3), [PREFIX + 'bad']: null, [PREFIX + 'mismatch']: entry('different'), setting: 'ignore' });
  assert.deepEqual(tasks.map(t => t.id), ['b', 'a', 'c']);
});

test('100-task limit prevents unlimited growth but existing tasks remain editable', async () => {
  const store = memory(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [PREFIX + i, entry(String(i))])));
  await assert.rejects(handleCommand(store, { type: 'add', text: 'One too many' }), /full/);
  const result = await handleCommand(store, { type: 'edit', id: '0', text: 'Still editable' });
  assert.equal(result.find(t => t.id === '0').text, 'Still editable');
});
