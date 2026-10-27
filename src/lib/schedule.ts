export const COLORS = ['#dcdffb', '#d5eaf9', '#d4ece2', '#f7e6bb', '#f7d9cc', '#f4d8e6', '#e6dcf4', '#d4ecee', '#e5ebcf', '#eedfd4'] as const;
export const LABELS = ['a', 'b', 'c', 'd', 'e', '가', '나', '다', '라', '마'] as const;
export const TASK_IDS = LABELS.map((_, index) => `task-${index}`);
export const SLOT_COUNT = 34;
export const MAX_TASKS_PER_GROUP = 10;
export type TaskGroup = 'work' | 'personal';
export type Task = { text: string; done: boolean };
export type ExtraTask = Task & { id: string; order: number };
export type TaskItem = Task & { id: string; label: string; color: string; extra: boolean; group: TaskGroup };
export type Day = { date: string; tasks: Task[]; extras: ExtraTask[]; slots: (string | null)[]; revision: number; updatedAt: string | null };
export type CarryoverResult = { imported: number; duplicates: number; remaining: number; total: number };
export type Operation = { type: 'text'; index: number; value: string } | { type: 'done'; index: number; value: boolean } | { type: 'slots'; indices: number[]; value: string | null } | { type: 'carryover'; group: TaskGroup } | { type: 'add'; group: TaskGroup; id: string } | { type: 'remove'; id: string } | { type: 'extra-text'; id: string; value: string } | { type: 'extra-done'; id: string; value: boolean };
export type DayResponse = { day: Day; storage: 'local' | 'cloud'; carryover?: CarryoverResult };

export function emptyDay(date: string): Day {
  return { date, tasks: LABELS.map(() => ({ text: '', done: false })), extras: [], slots: Array<string | null>(SLOT_COUNT).fill(null), revision: 0, updatedAt: null };
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validExtraId(value: unknown): value is string {
  return typeof value === 'string' && /^(work|personal)-(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|c-\d{1,12}-\d{1,3})$/.test(value);
}
export function validOperation(value: unknown): value is Operation {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  if (op.type === 'carryover') return op.group === 'work' || op.group === 'personal';
  if (op.type === 'add') return (op.group === 'work' || op.group === 'personal') && validExtraId(op.id) && op.id.startsWith(`${op.group}-`);
  if (op.type === 'remove') return validExtraId(op.id);
  if (op.type === 'extra-text' || op.type === 'extra-done') return validExtraId(op.id) && (op.type === 'extra-text' ? typeof op.value === 'string' && op.value.length <= 200 : typeof op.value === 'boolean');
  if (op.type === 'text' || op.type === 'done') {
    return Number.isInteger(op.index) && (op.index as number) >= 0 && (op.index as number) < 10 &&
      (op.type === 'text' ? typeof op.value === 'string' && op.value.length <= 200 : typeof op.value === 'boolean');
  }
  return op.type === 'slots' && Array.isArray(op.indices) && op.indices.length > 0 && op.indices.length <= SLOT_COUNT &&
    op.indices.every(index => Number.isInteger(index) && index >= 0 && index < SLOT_COUNT) &&
    (op.value === null || op.value === 'other' || TASK_IDS.includes(op.value as string) || validExtraId(op.value));
}
export function taskLabel(group: TaskGroup, index: number): string {
  const alphabet = group === 'work' ? 'abcdefghijklmnopqrstuvwxyz'.split('') : ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];
  let value = index + 1;
  let label = '';
  while (value > 0) { value--; label = alphabet[value % alphabet.length]! + label; value = Math.floor(value / alphabet.length); }
  return label;
}
export function groupTasks(day: Day, group: TaskGroup): TaskItem[] {
  const start = group === 'work' ? 0 : 5;
  const base = day.tasks.slice(start, start + 5).map((task, i) => ({ ...task, id: TASK_IDS[start + i]!, label: taskLabel(group, i), color: COLORS[start + i]!, extra: false, group }));
  const extras = (day.extras || []).filter(task => task.id.startsWith(`${group}-`)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return [...base, ...extras.map((task, i) => ({ ...task, label: taskLabel(group, i + 5), color: `hsl(${((task.order * 137.508) % 360).toFixed(3)} 62% 86%)`, extra: true, group }))];
}
export function allTasks(day: Day): TaskItem[] { return [...groupTasks(day, 'work'), ...groupTasks(day, 'personal')]; }
export function applyOperation(day: Day, op: Operation): Day {
  const next = structuredClone(day);
  next.extras ||= [];
  if (op.type === 'slots') {
    if (op.value !== null && op.value !== 'other' && !allTasks(next).some(task => task.id === op.value)) return next;
    for (const index of op.indices) next.slots[index] = op.value;
  } else if (op.type === 'text') next.tasks[op.index]!.text = op.value;
  else if (op.type === 'done') next.tasks[op.index]!.done = op.value;
  else if (op.type === 'add') {
    if (!next.extras.some(task => task.id === op.id) && groupTasks(next, op.group).length < MAX_TASKS_PER_GROUP) {
      next.extras.push({ id: op.id, text: '', done: false, order: Math.max((next.revision + 1) * 100, ...next.extras.map(task => task.order + 1)) });
    }
  } else if (op.type === 'remove') {
    next.extras = next.extras.filter(task => task.id !== op.id);
    next.slots = next.slots.map(id => id === op.id ? null : id);
  } else if (op.type === 'extra-text' || op.type === 'extra-done') {
    const task = next.extras.find(task => task.id === op.id);
    if (task) { if (op.type === 'extra-text') task.text = op.value; else task.done = op.value; }
  }
  return next;
}
export function slotTime(index: number): string {
  return `${String(7 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`;
}
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function previousDate(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}
export function carryoverTasks(day: Day, yesterday: Day, group: TaskGroup): { day: Day; carryover: CarryoverResult } {
  const next = structuredClone(day);
  next.extras ||= [];
  const tasks = groupTasks(next, group);
  const existing = new Set(tasks.map(task => task.text.trim()).filter(Boolean));
  const source = [...new Set(groupTasks(yesterday, group).filter(task => !task.done).map(task => task.text.trim()).filter(Boolean))];
  const carryover: CarryoverResult = { imported: 0, duplicates: 0, remaining: 0, total: source.length };
  const empty = tasks.filter(task => !task.text.trim());
  for (const [ordinal, text] of source.entries()) {
    if (existing.has(text)) { carryover.duplicates++; continue; }
    const available = empty.shift();
    if (available) {
      const task = available.extra ? next.extras.find(task => task.id === available.id)! : next.tasks[TASK_IDS.indexOf(available.id)]!;
      task.text = text;
      task.done = false;
    } else if (groupTasks(next, group).length < MAX_TASKS_PER_GROUP) {
      next.extras.push({ id: `${group}-c-${next.revision + 1}-${ordinal}`, text, done: false, order: (next.revision + 1) * 100 + ordinal });
    } else { carryover.remaining++; continue; }
    existing.add(text);
    carryover.imported++;
  }
  return { day: next, carryover };
}
