import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { handleCommand } from '../core.js';

function setup() {
  let document, data = {}, fail = false, changed;
  class Element {
    constructor(tag) {
      Object.assign(this, { tag, children: [], dataset: {}, attributes: {}, listeners: {}, value: '', textContent: '', hidden: false });
      this.classList = { toggle: () => {} };
    }
    append(...elements) { for (const element of elements) { element.parent = this; this.children.push(element); } }
    replaceChildren(...elements) { this.children = []; this.append(...elements); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    matches(selector) {
      if (selector === '[data-filter]') return Boolean(this.dataset.filter);
      return selector.startsWith('.') ? this.className?.split(' ').includes(selector.slice(1)) : this.tag === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
    querySelectorAll(selector) {
      const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
      if (selector === '*') return descendants;
      if (selector === '.edit-form input') return descendants.filter(child => child.tag === 'input' && child.parent?.className === 'edit-form');
      return descendants.filter(child => selector.split(', ').some(part => child.matches(part)));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0]; }
    focus() { document.activeElement = this; }
    select() {}
  }
  const ids = ['expand', 'summary', 'add-form', 'new-task', 'add', 'clear', 'tasks', 'empty', 'empty-title', 'empty-detail', 'status', 'retry', 'save-state', 'sync-help', 'sync-details', 'sync-settings'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(['expand', 'add', 'clear', 'retry', 'sync-help', 'sync-settings'].includes(id) ? 'button' : id === 'new-task' ? 'input' : id === 'add-form' ? 'form' : 'div')]));
  const root = new Element('body'); root.append(...Object.values(elements));
  for (const filter of ['all', 'active', 'done']) { const button = new Element('button'); button.dataset.filter = filter; root.append(button); }
  document = { body: root, activeElement: null, getElementById: id => elements[id], querySelectorAll: selector => root.querySelectorAll(selector), createElement: tag => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  const storage = {
    async get() { return structuredClone(data); },
    async set(values) { if (fail) throw new Error('Save failed'); Object.assign(data, structuredClone(values)); },
    async remove(keys) { if (fail) throw new Error('Save failed'); for (const key of [keys].flat()) delete data[key]; }
  };
  const chrome = {
    runtime: { id: 'test', async sendMessage(message) {
      try { return { ok: true, tasks: await handleCommand(storage, message.command) }; }
      catch (error) { return { ok: false, error: error.message }; }
    } },
    storage: { onChanged: { addListener(fn) { changed = fn; } } }
  };
  const context = vm.createContext({ document, chrome, URLSearchParams, location: { search: '' }, handleCommand });
  const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8').replace(/^import .*?;\n/, '');
  vm.runInContext(source, context);
  return { elements, document, storage, run: code => vm.runInContext(code, context), setFailure: value => { fail = value; }, changed: () => changed({}, 'sync') };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
const submit = () => ({ preventDefault() {} });

test('popup adds literal task text, completes it, filters it, and clears it', async () => {
  const h = setup(); await settle();
  const el = h.elements;
  el['new-task'].value = '<img src=x onerror=alert(1)>';
  el['add-form'].listeners.submit(submit()); await settle();
  assert.equal(el['new-task'].value, '');
  assert.equal(el.tasks.children[0].querySelector('.task-text').textContent, '<img src=x onerror=alert(1)>');
  const checkbox = el.tasks.querySelector('input'); checkbox.checked = true; checkbox.listeners.change(); await settle();
  assert.equal(el.summary.textContent, '0 left to do · 1 done');
  h.document.querySelectorAll('[data-filter]')[1].listeners.click();
  assert.equal(el.empty.hidden, false);
  el.clear.listeners.click(); await settle();
  assert.equal(h.run('tasks.length'), 0);
});

test('failed add keeps the draft, reports failure, and permits retry', async () => {
  const h = setup(); await settle();
  h.elements['new-task'].value = 'Keep this draft'; h.setFailure(true);
  h.elements['add-form'].listeners.submit(submit()); await settle();
  assert.equal(h.elements['new-task'].value, 'Keep this draft');
  assert.match(h.elements.status.textContent, /Save failed/);
  assert.equal(h.elements.add.disabled, false);
  assert.equal(h.run('tasks.length'), 0);
  h.setFailure(false); h.elements['add-form'].listeners.submit(submit()); await settle();
  assert.equal(h.run('tasks[0].text'), 'Keep this draft');
});

test('remote changes wait while editing and a failed edit preserves its draft', async () => {
  const h = setup(); await settle();
  h.elements['new-task'].value = 'Original'; h.elements['add-form'].listeners.submit(submit()); await settle();
  h.elements.tasks.querySelector('.edit').listeners.click();
  const form = h.elements.tasks.querySelector('.edit-form'); const input = form.querySelector('input');
  input.value = 'Unsaved edit'; h.changed(); await settle();
  assert.equal(h.elements.tasks.querySelector('.edit-form').querySelector('input'), input);
  h.setFailure(true); form.listeners.submit(submit()); await settle();
  assert.equal(input.value, 'Unsaved edit');
  assert.equal(input.disabled, false);
  h.setFailure(false); form.listeners.submit(submit()); await settle();
  assert.equal(h.run('tasks[0].text'), 'Unsaved edit');
});

test('popup receives changes made in another view without a reload', async () => {
  const h = setup(); await settle();
  await handleCommand(h.storage, { type: 'add', text: 'From the other computer' });
  h.changed(); await settle();
  assert.equal(h.elements.tasks.children[0].querySelector('.task-text').textContent, 'From the other computer');
});
