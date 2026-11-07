export const PREFIX = 'task:';
export const MAX_TASKS = 100;
export const MAX_LENGTH = 240;

export function readTasks(data) {
  return Object.entries(data)
    .filter(([key, task]) => key.startsWith(PREFIX) && task &&
      typeof task.id === 'string' && key === PREFIX + task.id &&
      typeof task.text === 'string' && typeof task.done === 'boolean' &&
      Number.isFinite(task.createdAt))
    .map(([, task]) => task)
    .sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

function cleanText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error('Give your task a name.');
  if (text.length > MAX_LENGTH) throw new Error(`Keep tasks to ${MAX_LENGTH} characters or fewer.`);
  return text;
}

// One key per task: an edit never rewrites the rest of another device's list.
export async function handleCommand(storage, command) {
  if (!command || typeof command.type !== 'string') throw new Error('Unknown action.');
  const tasks = readTasks(await storage.get(null));
  switch (command.type) {
    case 'list': break;
    case 'add': {
      const text = cleanText(command.text);
      if (tasks.length >= MAX_TASKS) throw new Error('Your list is full (100 tasks). Clear some completed tasks first.');
      const task = { id: crypto.randomUUID(), text, done: false, createdAt: Date.now() };
      await storage.set({ [PREFIX + task.id]: task });
      break;
    }
    case 'edit':
    case 'toggle': {
      const task = tasks.find(task => task.id === command.id);
      if (!task) throw new Error('This task was removed on another device. Reopen the list to refresh it.');
      const updated = { ...task };
      if (command.type === 'edit') updated.text = cleanText(command.text);
      else {
        if (typeof command.done !== 'boolean') throw new Error('Invalid completion state.');
        updated.done = command.done;
      }
      await storage.set({ [PREFIX + task.id]: updated });
      break;
    }
    case 'delete': {
      if (typeof command.id !== 'string' || !tasks.some(task => task.id === command.id)) break;
      await storage.remove(PREFIX + command.id);
      break;
    }
    case 'clearDone': {
      const keys = tasks.filter(task => task.done).map(task => PREFIX + task.id);
      if (keys.length) await storage.remove(keys);
      break;
    }
    default: throw new Error('Unknown action.');
  }
  return readTasks(await storage.get(null));
}
