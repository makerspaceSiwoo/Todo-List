import { COLORS, LABELS, TASK_IDS, SLOT_COUNT, emptyDay, applyOperation, slotTime, today, validOperation, type Day, type Operation, type DayResponse, type TaskGroup, type CarryoverResult } from '../lib/schedule';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const cells = [...document.querySelectorAll<HTMLButtonElement>('[data-slot]')];
const inputs = [...document.querySelectorAll<HTMLInputElement>('[data-input]')];
const checks = [...document.querySelectorAll<HTMLInputElement>('[data-check]')];
const selects = [...document.querySelectorAll<HTMLButtonElement>('[data-select]')];
const carryoverButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-carryover]')];
const carryoverMessages = new Map<string, string>();
const dateInput = $<HTMLInputElement>('#date');
const grid = $('#timetable');
const lock = $<HTMLInputElement>('#lock');
const sync = $('.sync');
type Pending = { id: string; operation: Operation };
type Gesture = { pointer: number; start: number; end: number; x: number; y: number; granular: boolean; value: string | null; baseline: (string | null)[]; preview: (string | null)[]; timer: ReturnType<typeof setTimeout> };
const days = new Map<string, Day>();
const ready = new Set<string>();
const pending: Record<string, Pending[]> = {};
let date = today();
let selected: string | null = null;
let storage: 'local' | 'cloud' | null = null;
let busy = false;
let inFlight: string | null = null;
let error = '';
let localPersistenceFailed = false;
let gesture: Gesture | null = null;
let saveTimer: ReturnType<typeof setTimeout>;
const pendingKey = 'daypiece.pending.v1';
try {
  const saved = JSON.parse(localStorage.getItem(pendingKey) || '{}') as Record<string, Pending[]>;
  for (const [key, entries] of Object.entries(saved)) if (/^\d{4}-\d{2}-\d{2}$/.test(key) && Array.isArray(entries)) {
    pending[key] = entries.filter(entry => typeof entry.id === 'string' && validOperation(entry.operation));
  }
  lock.checked = localStorage.getItem('daypiece.locked') === 'true';
} catch { /* A browser without local storage can still sync directly. */ }

function current(): Day {
  return (pending[date] || []).reduce((day, entry) => applyOperation(day, entry.operation), days.get(date) || emptyDay(date));
}
function persist(): void {
  try { localStorage.setItem(pendingKey, JSON.stringify(pending)); localPersistenceFailed = false; }
  catch { localPersistenceFailed = true; }
}
function syncStatus(): void {
  const count = Object.values(pending).reduce((sum, list) => sum + list.length, 0);
  sync.dataset.state = error ? 'error' : busy || count ? 'saving' : 'ok';
  $('#sync-status').textContent = error ? '연결 확인 필요' : busy || count ? '저장 중' : !ready.has(date) ? '연결 중' : storage === 'local' ? '이 컴퓨터에 저장됨' : '공유 저장됨';
  $('#retry').hidden = !error;
  const notice = $('#connection-notice');
  notice.hidden = !error && storage !== 'local' && !localPersistenceFailed;
  notice.classList.toggle('error', !!error || localPersistenceFailed);
  notice.textContent = error ? `${error}${count ? ` 저장 대기 중인 변경 ${count}개가 있습니다. 연결 후 다시 시도해 주세요.` : ''}` : localPersistenceFailed ? '브라우저 임시 저장을 사용할 수 없습니다. 공유 저장이 끝나기 전에 창을 닫지 마세요.' : '로컬 개발 모드 · 이 컴퓨터의 파일에 저장됩니다. 다른 컴퓨터와 공유하려면 Vercel에 공유 저장소를 연결해 주세요.';
}
function selectionNote(): void {
  const note = $('#selection-note');
  const text = note.querySelector('span:last-child')!;
  const dot = note.querySelector<HTMLElement>('.selection-dot')!;
  const index = TASK_IDS.indexOf(selected || '');
  dot.style.background = selected === 'other' ? '#d1d5df' : index >= 0 ? COLORS[index]! : '#d0d5e4';
  text.textContent = lock.checked ? '잠금 모드예요. 시간을 편집하려면 잠금을 해제해 주세요.' : selected === 'other' ? '기타 선택 중 · 쉬는 시간과 여백을 그려보세요.' : index >= 0 ? `${LABELS[index]}. ${current().tasks[index]!.text || '아직 이름 없는 할 일'} · 시간을 선택해 주세요.` : '할 일을 선택하면 시간에 색을 입힐 수 있어요.';
}
function render(): void {
  const day = current();
  const slots = gesture?.preview || day.slots;
  const isReady = ready.has(date);
  dateInput.value = date;
  const d = new Date(`${date}T12:00:00+09:00`);
  $('#date-label').textContent = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(d);
  $('#weekday').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Seoul' }).format(d).toUpperCase();
  $('#today').classList.toggle('active', date === today());
  inputs.forEach((input, i) => {
    const task = day.tasks[i]!;
    if (input.value !== task.text) input.value = task.text;
    const importing = (pending[date] || []).some(entry => entry.operation.type === 'carryover' && entry.operation.group === (i < 5 ? 'work' : 'personal'));
    input.disabled = !isReady || importing;
    checks[i]!.checked = task.done;
    checks[i]!.disabled = !isReady || importing;
    selects[i]!.disabled = !isReady || importing;
    const item = input.closest('.task-item')!;
    item.classList.toggle('selected', selected === TASK_IDS[i]);
    item.classList.toggle('done', task.done);
    selects[i]!.setAttribute('aria-pressed', String(selected === TASK_IDS[i]));
  });
  carryoverButtons.forEach(button => {
    const group = button.dataset.carryover as TaskGroup;
    const importing = (pending[date] || []).some(entry => entry.operation.type === 'carryover' && entry.operation.group === group);
    button.disabled = !isReady || importing;
    button.textContent = importing ? '가져오는 중…' : '이어하기';
    $(`#carryover-status-${group}`).textContent = importing ? '어제의 미완료 작업을 가져오고 있어요.' : carryoverMessages.get(`${date}:${group}`) || '';
  });
  $('#other').setAttribute('aria-pressed', String(selected === 'other'));
  cells.forEach((cell, i) => {
    const id = slots[i] ?? null;
    const taskIndex = TASK_IDS.indexOf(id || '');
    const task = taskIndex >= 0 ? day.tasks[taskIndex] : undefined;
    const color = task?.done ? '#eceef2' : id === 'other' ? '#dedfe5' : taskIndex >= 0 ? COLORS[taskIndex]! : '';
    cell.style.backgroundColor = color;
    cell.dataset.filled = String(!!id);
    cell.dataset.done = String(!!task?.done);
    cell.disabled = lock.checked || !isReady;
    const name = id === 'other' ? '기타' : task ? `${LABELS[taskIndex]}. ${task.text || '할 일'}` : '';
    cell.querySelector('.cell-label')!.textContent = name;
    cell.setAttribute('aria-label', `${slotTime(i)}–${slotTime(i + 1)} ${name || '비어 있음'}${task?.done ? ' (완료)' : ''}`);
    cell.setAttribute('aria-pressed', String(!!id));
    const meter = $<HTMLElement>(`[data-meter="${i}"]`);
    meter.style.backgroundColor = color;
    meter.title = `${slotTime(i)} ${name || '여백'}`;
  });
  const written = day.tasks.filter(task => task.text.trim());
  const completed = written.filter(task => task.done).length;
  $('#task-count').textContent = `${completed} / ${written.length} 완료`;
  $('#completion-percent').textContent = `${written.length ? Math.round(completed / written.length * 100) : 0}%`;
  const occupied = slots.filter(Boolean).length / 2;
  const done = slots.filter(id => id && TASK_IDS.includes(id) && day.tasks[TASK_IDS.indexOf(id)]?.done).length / 2;
  $('#planned-hours').innerHTML = `${occupied}<small>시간</small>`;
  $('#done-hours').innerHTML = `${done}<small>시간</small>`;
  $('#free-hours').innerHTML = `${17 - occupied}<small>시간</small>`;
  $('#lock-label').textContent = lock.checked ? '잠금 모드' : '편집 가능';
  grid.classList.toggle('locked', lock.checked);
  selectionNote();
  syncStatus();
}
function accept(result: DayResponse): void {
  const existing = days.get(result.day.date);
  if (!existing || result.day.revision >= existing.revision) days.set(result.day.date, result.day);
  storage = result.storage;
  ready.add(result.day.date);
}
async function request(dayDate: string, operation?: Operation): Promise<DayResponse> {
  const response = await fetch(`/api/day?date=${dayDate}`, {
    method: operation ? 'PATCH' : 'GET', cache: 'no-store',
    headers: operation ? { 'Content-Type': 'application/json' } : {},
    body: operation ? JSON.stringify(operation) : undefined, signal: AbortSignal.timeout(12000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '저장소에 연결하지 못했습니다.');
  return result as DayResponse;
}
async function load(dayDate: string): Promise<void> {
  try {
    accept(await request(dayDate));
    error = '';
  } catch (cause) { error = cause instanceof Error ? cause.message : '네트워크 연결을 확인해 주세요.'; }
  if (date === dayDate) render();
}
async function pump(): Promise<void> {
  if (busy || !navigator.onLine) { syncStatus(); return; }
  busy = true;
  syncStatus();
  try {
    for (;;) {
      const key = Object.keys(pending).find(key => pending[key]!.length && ready.has(key));
      if (!key) break;
      const entry = pending[key]![0]!;
      inFlight = entry.id;
      const result = await request(key, entry.operation);
      accept(result);
      if (entry.operation.type === 'carryover' && result.carryover) {
        carryoverMessages.set(`${key}:${entry.operation.group}`, carryoverMessage(result.carryover));
      }
      pending[key] = pending[key]!.filter(item => item.id !== entry.id);
      if (!pending[key]!.length) delete pending[key];
      persist();
      error = '';
      render();
    }
  } catch (cause) { error = cause instanceof Error ? cause.message : '변경 사항을 저장하지 못했습니다.'; }
  finally { busy = false; inFlight = null; syncStatus(); }
}
function carryoverMessage(result: CarryoverResult): string {
  if (!result.total) return '어제 미완료 작업이 없어요.';
  if (result.imported) return `어제 미완료 작업 ${result.imported}개를 가져왔어요.${result.remaining ? ` 빈칸이 부족해 ${result.remaining}개는 가져오지 못했어요.` : ''}`;
  if (result.remaining) return `빈칸이 부족해 ${result.remaining}개를 가져오지 못했어요. 오늘 할 일은 그대로 유지했어요.`;
  return '어제 미완료 작업이 이미 목록에 있어요.';
}
function enqueue(operation: Operation, delay = 0): void {
  const list = pending[date] ||= [];
  // Only replace a not-yet-sent text edit. Never modify the request currently in flight.
  const previous = list.at(-1);
  if (operation.type === 'text' && previous?.id !== inFlight && previous?.operation.type === 'text' && previous.operation.index === operation.index) previous.operation = operation;
  else list.push({ id: crypto.randomUUID(), operation });
  persist();
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void pump(), delay);
}
function select(id: string): void { selected = id; render(); }
inputs.forEach((input, index) => {
  input.addEventListener('focus', () => select(TASK_IDS[index]!));
  input.addEventListener('input', () => enqueue({ type: 'text', index, value: input.value }, 400));
  input.addEventListener('blur', () => { clearTimeout(saveTimer); void pump(); });
});
selects.forEach((button, index) => button.addEventListener('click', () => select(TASK_IDS[index]!)));
checks.forEach((check, index) => check.addEventListener('change', () => enqueue({ type: 'done', index, value: check.checked })));
$('#other').addEventListener('click', () => select('other'));
carryoverButtons.forEach(button => button.addEventListener('click', () => {
  const group = button.dataset.carryover as TaskGroup;
  if (!ready.has(date) || button.disabled) return;
  enqueue({ type: 'carryover', group });
}));

function canPaint(): boolean { return !!selected && !lock.checked && ready.has(date); }
function slotAt(x: number, y: number): number | null {
  const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-slot]');
  return target && grid.contains(target) ? Number(target.dataset.slot) : null;
}
function previewGesture(): void {
  if (!gesture) return;
  const g = gesture;
  const indices = g.granular ? Array.from({ length: Math.abs(g.end - g.start) + 1 }, (_, i) => Math.min(g.start, g.end) + i) : [Math.floor(g.start / 2) * 2, Math.floor(g.start / 2) * 2 + 1];
  g.preview = [...g.baseline];
  const value = g.granular ? g.value : indices.every(i => g.baseline[i] === selected) ? null : selected;
  for (const index of indices) g.preview[index] = value;
  render();
}
function cancelGesture(): void {
  if (!gesture) return;
  clearTimeout(gesture.timer);
  const pointer = gesture.pointer;
  gesture = null;
  if (grid.hasPointerCapture(pointer)) grid.releasePointerCapture(pointer);
  render();
}
grid.addEventListener('pointerdown', event => {
  if (!canPaint() || gesture || !event.isPrimary || event.button !== 0) return;
  const index = slotAt(event.clientX, event.clientY);
  if (index === null) return;
  event.preventDefault();
  const baseline = [...current().slots];
  const timer = setTimeout(() => {
    if (gesture) { gesture.granular = true; previewGesture(); }
  }, 300);
  gesture = { pointer: event.pointerId, start: index, end: index, x: event.clientX, y: event.clientY, granular: false, value: baseline[index] === selected ? null : selected, baseline, preview: baseline, timer };
  grid.setPointerCapture(event.pointerId);
});
grid.addEventListener('pointermove', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6 && !gesture.granular) return;
  const index = slotAt(event.clientX, event.clientY);
  if (index === null) return;
  clearTimeout(gesture.timer);
  gesture.granular = true;
  gesture.end = index;
  previewGesture();
});
grid.addEventListener('pointerup', event => {
  if (!gesture || gesture.pointer !== event.pointerId) return;
  clearTimeout(gesture.timer);
  previewGesture();
  const g = gesture;
  const indices = g.granular ? Array.from({ length: Math.abs(g.end - g.start) + 1 }, (_, i) => Math.min(g.start, g.end) + i) : [Math.floor(g.start / 2) * 2, Math.floor(g.start / 2) * 2 + 1];
  const value = g.preview[indices[0]!] ?? null;
  gesture = null;
  grid.releasePointerCapture(event.pointerId);
  enqueue({ type: 'slots', indices, value });
});
grid.addEventListener('pointercancel', cancelGesture);
grid.addEventListener('lostpointercapture', cancelGesture);
// Native button keyboard activation selects 30 minutes; Shift + Enter selects the hour.
cells.forEach((cell, index) => {
  cell.addEventListener('click', event => {
    if (event.detail !== 0 || !canPaint()) return;
    enqueue({ type: 'slots', indices: [index], value: current().slots[index] === selected ? null : selected });
  });
  cell.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancelGesture();
    if (event.key === 'Enter' && event.shiftKey && canPaint()) {
      event.preventDefault();
      const indices = [Math.floor(index / 2) * 2, Math.floor(index / 2) * 2 + 1];
      enqueue({ type: 'slots', indices, value: indices.every(i => current().slots[i] === selected) ? null : selected });
    }
    const offset = event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (offset) { event.preventDefault(); cells[Math.max(0, Math.min(SLOT_COUNT - 1, index + offset))]?.focus(); }
  });
});
lock.addEventListener('change', () => {
  cancelGesture();
  try { localStorage.setItem('daypiece.locked', String(lock.checked)); } catch { /* Optional preference. */ }
  render();
});
async function changeDate(value: string): Promise<void> {
  cancelGesture();
  clearTimeout(saveTimer);
  void pump();
  date = value;
  render();
  await load(value);
  void pump();
}
function shiftDate(offset: number): void {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  void changeDate(d.toISOString().slice(0, 10));
}
dateInput.addEventListener('change', () => { if (dateInput.value) void changeDate(dateInput.value); });
$('#prev-day').addEventListener('click', () => shiftDate(-1));
$('#next-day').addEventListener('click', () => shiftDate(1));
$('#today').addEventListener('click', () => void changeDate(today()));
async function reconnect(): Promise<void> {
  await load(date);
  for (const key of Object.keys(pending)) if (!ready.has(key)) await load(key);
  void pump();
}
$('#retry').addEventListener('click', () => void reconnect());
window.addEventListener('online', () => void reconnect());
window.addEventListener('offline', () => { error = '오프라인입니다. 네트워크 연결을 확인해 주세요.'; syncStatus(); });
window.addEventListener('beforeunload', event => {
  persist();
  if (Object.values(pending).some(list => list.length)) event.preventDefault();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reconnect(); });
setInterval(() => {
  if (document.visibilityState === 'visible' && !gesture && !busy && navigator.onLine) void reconnect();
}, 4000);
render();
void reconnect();
