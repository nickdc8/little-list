import { handleCommand } from './core.js';

const $ = id => document.getElementById(id);
const extension = Boolean(globalThis.chrome?.runtime?.id);
const fullPage = !extension || new URLSearchParams(location.search).has('view');
document.body.classList.toggle('full-page', fullPage);
$('expand').hidden = fullPage;
let tasks = [], filter = 'all', editing = null, busy = false, loaded = false, refreshNeeded = false;
let previewQueue = Promise.resolve();
const previewStorage = {
  async get() { return JSON.parse(localStorage.getItem('little-list-preview') || '{}'); },
  async set(values) { localStorage.setItem('little-list-preview', JSON.stringify({ ...await this.get(), ...values })); },
  async remove(keys) { const data = await this.get(); for (const key of [keys].flat()) delete data[key]; localStorage.setItem('little-list-preview', JSON.stringify(data)); }
};
async function request(command) {
  if (!extension) {
    const result = previewQueue.then(() => handleCommand(previewStorage, command));
    previewQueue = result.catch(() => {});
    return result;
  }
  const response = await chrome.runtime.sendMessage({ target: 'little-list', command });
  if (!response?.ok) throw new Error(response?.error || 'Chrome could not save this change. Please try again.');
  return response.tasks;
}

function iconButton(label, path, className, action) {
  const button = document.createElement('button');
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', label);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(svg.namespaceURI, 'path');
  line.setAttribute('d', path);
  svg.append(line); button.append(svg);
  button.addEventListener('click', action);
  return button;
}

function render(focusId) {
  const active = tasks.filter(task => !task.done).length;
  $('summary').textContent = tasks.length ? `${active} left to do · ${tasks.length - active} done` : 'A quiet place for things to do.';
  $('clear').disabled = !loaded || busy || !tasks.some(task => task.done);
  $('new-task').disabled = !loaded || busy;
  $('add').disabled = !loaded || busy;
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
  const visible = tasks.filter(task => filter === 'all' || (filter === 'done' ? task.done : !task.done));
  $('tasks').replaceChildren();
  for (const task of visible) {
    const row = document.createElement('li');
    row.className = `task${task.done ? ' done' : ''}`;
    row.dataset.id = task.id;
    if (editing === task.id) {
      const form = document.createElement('form'); form.className = 'edit-form';
      const input = document.createElement('input'); input.value = task.text; input.maxLength = 240; input.required = true; input.setAttribute('aria-label', 'Edit task');
      const save = document.createElement('button'); save.type = 'submit'; save.textContent = 'Save';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
      const cancelEdit = () => { editing = null; render(task.id); void refresh(); };
      cancel.addEventListener('click', cancelEdit);
      input.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); } });
      form.addEventListener('submit', event => { event.preventDefault(); void mutate({ type: 'edit', id: task.id, text: input.value }, task.id); });
      form.append(input, save, cancel); row.append(form);
    } else {
      const label = document.createElement('label'); label.className = 'task-label';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = task.done;
      checkbox.addEventListener('change', () => { void mutate({ type: 'toggle', id: task.id, done: checkbox.checked }, task.id); });
      const text = document.createElement('span'); text.className = 'task-text'; text.textContent = task.text;
      label.append(checkbox, text);
      const actions = document.createElement('div'); actions.className = 'task-actions';
      actions.append(iconButton(`Edit: ${task.text}`, 'm16 3 5 5-12 12-6 1 1-6ZM14 5l5 5', 'edit', () => {
        editing = task.id; render(); const input = $('tasks').querySelector('.edit-form input'); input.focus(); input.select();
      }), iconButton(`Delete: ${task.text}`, 'M6 6l12 12M6 18 18 6', 'delete', () => {
        const index = visible.indexOf(task);
        const next = visible[index + 1] || visible[index - 1];
        void mutate({ type: 'delete', id: task.id }, next?.id || 'new-task');
      }));
      row.append(label, actions);
    }
    row.querySelectorAll('button, input').forEach(control => { control.disabled = busy; });
    $('tasks').append(row);
  }
  $('empty').hidden = !loaded || visible.length > 0;
  $('empty-title').textContent = filter === 'done' ? 'Nothing ticked off yet.' : tasks.length ? 'All clear for now.' : 'A little room to think.';
  $('empty-detail').textContent = filter === 'done' ? 'Completed tasks will appear here.' : tasks.length ? 'One less thing on your mind.' : 'Add your first task above.';
  if (focusId) {
    const row = [...$('tasks').children].find(row => row.dataset.id === focusId);
    (row?.querySelector('input') || $('new-task')).focus();
  }
}

async function refresh() {
  if (busy || editing) { refreshNeeded = true; return; }
  refreshNeeded = false;
  const focusedRow = document.activeElement?.closest('.task')?.dataset.id;
  try {
    tasks = await request({ type: 'list' }); loaded = true;
    $('retry').hidden = true;
    render(focusedRow);
  } catch (error) {
    $('status').textContent = `Could not load your list. ${error.message}`;
    $('retry').hidden = false;
  }
}

async function mutate(command, focusId) {
  if (busy) return;
  busy = true;
  $('status').textContent = '';
  // Keep the edit draft intact while waiting for Chrome to save it.
  document.querySelectorAll('button, input').forEach(control => { control.disabled = true; });
  try {
    tasks = await request(command);
    editing = null;
    if (command.type === 'add') $('new-task').value = '';
    $('save-state').textContent = extension ? 'Saved in Chrome · syncs with your account' : 'Preview only · saved on this browser';
    busy = false;
    document.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
    render(focusId);
  } catch (error) {
    $('status').textContent = error.message;
    busy = false;
    document.querySelectorAll('button, input').forEach(control => { control.disabled = false; });
    $('clear').disabled = !tasks.some(task => task.done);
    // A failed toggle must return to the saved state; keep edit/add drafts for retry.
    if (command.type !== 'edit') render(focusId);
  }
  if (refreshNeeded && !editing) void refresh();
}

$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('new-task').value.trim()) void mutate({ type: 'add', text: $('new-task').value }, 'new-task');
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  editing = null; filter = button.dataset.filter; render();
  if (refreshNeeded) void refresh();
}));
$('clear').addEventListener('click', () => { void mutate({ type: 'clearDone' }, 'new-task'); });
$('retry').addEventListener('click', () => { $('status').textContent = ''; void refresh(); });
$('expand').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') }));
$('sync-help').addEventListener('click', () => {
  const show = $('sync-details').hidden;
  $('sync-details').hidden = !show;
  $('sync-help').setAttribute('aria-expanded', String(show));
});
$('sync-settings').addEventListener('click', () => { if (extension) void chrome.tabs.create({ url: 'chrome://settings/syncSetup' }); });
if (extension) chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync') void refresh(); });
else {
  $('save-state').textContent = 'Preview only · saved on this browser';
  $('sync-settings').hidden = true;
  window.addEventListener('storage', event => { if (event.key === 'little-list-preview') void refresh(); });
}
void refresh();
