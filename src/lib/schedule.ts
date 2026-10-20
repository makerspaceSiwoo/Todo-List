export const COLORS = ['#dcdffb', '#d5eaf9', '#d4ece2', '#f7e6bb', '#f7d9cc', '#f4d8e6', '#e6dcf4', '#d4ecee', '#e5ebcf', '#eedfd4'] as const;
export const LABELS = ['a', 'b', 'c', 'd', 'e', '가', '나', '다', '라', '마'] as const;
export const TASK_IDS = LABELS.map((_, index) => `task-${index}`);
export const SLOT_COUNT = 34;
export type Task = { text: string; done: boolean };
export type Day = { date: string; tasks: Task[]; slots: (string | null)[]; revision: number; updatedAt: string | null };
export type TaskGroup = 'work' | 'personal';
export type CarryoverResult = { imported: number; duplicates: number; remaining: number; total: number };
export type Operation = { type: 'text'; index: number; value: string } | { type: 'done'; index: number; value: boolean } | { type: 'slots'; indices: number[]; value: string | null } | { type: 'carryover'; group: TaskGroup };
export type DayResponse = { day: Day; storage: 'local' | 'cloud'; carryover?: CarryoverResult };

export function emptyDay(date: string): Day {
  return { date, tasks: LABELS.map(() => ({ text: '', done: false })), slots: Array<string | null>(SLOT_COUNT).fill(null), revision: 0, updatedAt: null };
}
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validOperation(value: unknown): value is Operation {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  if (op.type === 'carryover') return op.group === 'work' || op.group === 'personal';
  if (op.type === 'text' || op.type === 'done') {
    return Number.isInteger(op.index) && (op.index as number) >= 0 && (op.index as number) < 10 &&
      (op.type === 'text' ? typeof op.value === 'string' && op.value.length <= 200 : typeof op.value === 'boolean');
  }
  return op.type === 'slots' && Array.isArray(op.indices) && op.indices.length > 0 && op.indices.length <= SLOT_COUNT &&
    op.indices.every(index => Number.isInteger(index) && index >= 0 && index < SLOT_COUNT) &&
    (op.value === null || op.value === 'other' || TASK_IDS.includes(op.value as string));
}
export function applyOperation(day: Day, op: Operation): Day {
  const next = structuredClone(day);
  if (op.type === 'slots') for (const index of op.indices) next.slots[index] = op.value;
  else if (op.type === 'text') next.tasks[op.index]!.text = op.value;
  else if (op.type === 'done') next.tasks[op.index]!.done = op.value;
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
  const start = group === 'work' ? 0 : 5;
  const tasks = next.tasks.slice(start, start + 5);
  const existing = new Set(tasks.map(task => task.text.trim()).filter(Boolean));
  const source = [...new Set(yesterday.tasks.slice(start, start + 5).filter(task => !task.done).map(task => task.text.trim()).filter(Boolean))];
  const carryover: CarryoverResult = { imported: 0, duplicates: 0, remaining: 0, total: source.length };
  for (const text of source) {
    if (existing.has(text)) { carryover.duplicates++; continue; }
    const index = tasks.findIndex(task => !task.text.trim());
    if (index === -1) { carryover.remaining++; continue; }
    tasks[index]!.text = text;
    tasks[index]!.done = false;
    existing.add(text);
    carryover.imported++;
  }
  return { day: next, carryover };
}
