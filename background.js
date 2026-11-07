import { handleCommand, readTasks } from './core.js';

let queue = Promise.resolve();

async function updateBadge() {
  try {
    const tasks = readTasks(await chrome.storage.sync.get(null));
    const count = tasks.filter(task => !task.done).length;
    await chrome.action.setBadgeBackgroundColor({ color: '#276747' });
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    await chrome.action.setTitle({ title: count ? `Little List · ${count} left to do` : 'Little List' });
  } catch (error) { console.warn('Could not update task count:', error.message); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== 'little-list') return;
  queue = queue.catch(() => {}).then(async () => {
    try {
      const tasks = await handleCommand(chrome.storage.sync, message.command);
      respond({ ok: true, tasks });
    } catch (error) {
      const quota = /quota|MAX_WRITE|QUOTA_BYTES/i.test(error.message);
      respond({ ok: false, error: quota
        ? 'Chrome could not save this change: its sync limit was reached. Wait a minute, or clear completed tasks, then try again.'
        : error.message });
    }
  });
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') void updateBadge();
});
chrome.runtime.onInstalled.addListener(() => { void updateBadge(); });
chrome.runtime.onStartup.addListener(() => { void updateBadge(); });
