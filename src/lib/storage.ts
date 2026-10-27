import { emptyDay, applyOperation, carryoverTasks, previousDate, validExtraId, MAX_TASKS_PER_GROUP, type Day, type DayResponse, type Operation } from './schedule';

type Fields = Record<string, string>;
function redisConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || import.meta.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || import.meta.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || import.meta.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || import.meta.env.KV_REST_API_TOKEN,
  };
}
function fromFields(date: string, fields: Fields): Day {
  const day = emptyDay(date);
  for (let i = 0; i < 10; i++) day.tasks[i] = { text: fields[`text:${i}`] ?? '', done: fields[`done:${i}`] === 'true' };
  for (const [field, value] of Object.entries(fields)) {
    if (!field.startsWith('extra:') || !validExtraId(field.slice(6))) continue;
    const [text, done, order] = JSON.parse(value) as [string, boolean, number];
    day.extras.push({ id: field.slice(6), text, done, order });
  }
  day.extras.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (let i = 0; i < 34; i++) day.slots[i] = fields[`slot:${i}`] || null;
  day.revision = Number(fields.revision || 0);
  day.updatedAt = fields.updatedAt || null;
  return day;
}
async function redis(command: unknown[]): Promise<unknown> {
  const { url, token } = redisConfig();
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('공유 저장소에 연결할 수 없습니다.');
  const result = await response.json() as { result: unknown; error?: string };
  if (result.error) throw new Error('공유 저장소 요청에 실패했습니다.');
  return result.result;
}
// One hash per date. Default rows/colors are derived; each extra uses one compact
// [text, done, order] field. Deletions remove fields instead of keeping tombstones.
const MUTATE_SCRIPT = `
local op = cjson.decode(ARGV[1])
local limit = tonumber(ARGV[3])
local revision = (tonumber(redis.call('HGET', KEYS[1], 'revision')) or 0) + 1
local changed = false
local function put(field, value)
  if value == nil or value == '' or value == 'false' then
    if redis.call('HDEL', KEYS[1], field) > 0 then changed = true end
  elseif redis.call('HGET', KEYS[1], field) ~= value then
    redis.call('HSET', KEYS[1], field, value)
    changed = true
  end
end
local function trim(text) return (text:gsub('^%s+', ''):gsub('%s+$', '')) end
local function groupTasks(key, group)
  local list, extras = {}, {}
  local start = group == 'work' and 0 or 5
  for i = start, start + 4 do
    table.insert(list, {id='task-' .. i, index=i, text=redis.call('HGET', key, 'text:' .. i) or '', done=redis.call('HGET', key, 'done:' .. i) == 'true'})
  end
  local fields = redis.call('HGETALL', key)
  for i = 1, #fields, 2 do
    if string.sub(fields[i], 1, #group + 7) == 'extra:' .. group .. '-' then
      local value = cjson.decode(fields[i + 1])
      table.insert(extras, {id=string.sub(fields[i], 7), text=value[1], done=value[2], order=value[3]})
    end
  end
  table.sort(extras, function(a,b) if a.order == b.order then return a.id < b.id else return a.order < b.order end end)
  for _, task in ipairs(extras) do table.insert(list, task) end
  return list
end
local function writeTask(task, text, done)
  if task.index ~= nil then
    put('text:' .. task.index, text)
    put('done:' .. task.index, done and 'true' or nil)
  else put('extra:' .. task.id, cjson.encode({text, done, task.order})) end
end
local imported, duplicates, remaining, total = 0, 0, 0, 0
if op.type == 'text' or op.type == 'done' then
  local value = op.value
  if op.type == 'done' then value = value and 'true' or nil end
  put(op.type .. ':' .. op.index, value)
elseif op.type == 'slots' then
  local value = op.value
  if value == cjson.null then value = nil end
  local valid = value == nil or value == 'other' or string.match(value, '^task%-%d$') or redis.call('HEXISTS', KEYS[1], 'extra:' .. value) == 1
  if valid then for _, index in ipairs(op.indices) do put('slot:' .. index, value) end end
elseif op.type == 'add' then
  if redis.call('HEXISTS', KEYS[1], 'extra:' .. op.id) == 0 and #groupTasks(KEYS[1], op.group) < limit then
    put('extra:' .. op.id, cjson.encode({'', false, revision * 100}))
  end
elseif op.type == 'remove' then
  put('extra:' .. op.id, nil)
  for i = 0, 33 do
    if redis.call('HGET', KEYS[1], 'slot:' .. i) == op.id then put('slot:' .. i, nil) end
  end
elseif op.type == 'extra-text' or op.type == 'extra-done' then
  local raw = redis.call('HGET', KEYS[1], 'extra:' .. op.id)
  if raw then
    local task = cjson.decode(raw)
    if op.type == 'extra-text' then task[1] = op.value else task[2] = op.value end
    put('extra:' .. op.id, cjson.encode(task))
  end
elseif op.type == 'carryover' then
  local tasks = groupTasks(KEYS[1], op.group)
  local source = groupTasks(KEYS[2], op.group)
  local existing, seen, empty = {}, {}, {}
  for _, task in ipairs(tasks) do
    local text = trim(task.text)
    if text == '' then table.insert(empty, task) else existing[text] = true end
  end
  local available = 1
  for ordinal, task in ipairs(source) do
    local text = trim(task.text)
    if text ~= '' and not task.done and not seen[text] then
      seen[text] = true
      total = total + 1
      if existing[text] then duplicates = duplicates + 1
      else
        local target = empty[available]
        if target then available = available + 1
        elseif #tasks < limit then
          target = {id=op.group .. '-c-' .. revision .. '-' .. ordinal, order=revision * 100 + ordinal}
          table.insert(tasks, target)
        end
        if target then
          writeTask(target, text, false)
          existing[text] = true
          imported = imported + 1
        else remaining = remaining + 1 end
      end
    end
  end
end
if changed then
  redis.call('HSET', KEYS[1], 'revision', revision, 'updatedAt', ARGV[2])
end
return {redis.call('HGETALL', KEYS[1]), imported, duplicates, remaining, total}
`;
function parseFields(result: unknown): Fields {
  return Array.isArray(result) ? Object.fromEntries(Array.from({ length: result.length / 2 }, (_, i) => [result[i * 2], String(result[i * 2 + 1])])) : (result || {}) as Fields;
}
let localQueue: Promise<unknown> = Promise.resolve();
export async function accessDay(date: string, op?: Operation): Promise<DayResponse> {
  const { url, token } = redisConfig();
  const namespace = process.env.SCHEDULE_NAMESPACE || import.meta.env.SCHEDULE_NAMESPACE || process.env.VERCEL_ENV || import.meta.env.VERCEL_ENV || 'development';
  if (url && token) {
    const key = `daypiece:${namespace}:${date}`;
    if (op) {
      const keys = op.type === 'carryover' ? [key, `daypiece:${namespace}:${previousDate(date)}`] : [key];
      const result = await redis(['EVAL', MUTATE_SCRIPT, keys.length, ...keys, JSON.stringify(op), new Date().toISOString(), MAX_TASKS_PER_GROUP]) as [unknown, number, number, number, number];
      return { day: fromFields(date, parseFields(result[0])), storage: 'cloud', ...(op.type === 'carryover' ? { carryover: { imported: result[1], duplicates: result[2], remaining: result[3], total: result[4] } } : {}) };
    }
    return { day: fromFields(date, parseFields(await redis(['HGETALL', key]))), storage: 'cloud' };
  }
  if (!import.meta.env.DEV || process.env.VERCEL) throw new Error('공유 저장소 설정이 필요합니다. Vercel에서 Upstash Redis 환경 변수를 연결해 주세요.');
  const run = localQueue.then(async () => {
    const { mkdir, readFile, writeFile, rename } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const directory = resolve(process.env.SCHEDULE_DATA_DIR || '.data', namespace);
    const file = resolve(directory, `${date}.json`);
    await mkdir(directory, { recursive: true });
    async function readDay(dayDate: string): Promise<Day> {
      try { const day = JSON.parse(await readFile(resolve(directory, `${dayDate}.json`), 'utf8')) as Day; day.extras ||= []; return day; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return emptyDay(dayDate); }
    }
    let day = await readDay(date);
    const imported = op?.type === 'carryover' ? carryoverTasks(day, await readDay(previousDate(date)), op.group) : undefined;
    const next = imported?.day || (op ? applyOperation(day, op) : day);
    if (JSON.stringify(next) !== JSON.stringify(day)) {
      day = next;
      day.revision++;
      day.updatedAt = new Date().toISOString();
      await writeFile(`${file}.tmp`, JSON.stringify(day));
      await rename(`${file}.tmp`, file);
    }
    return { day, storage: 'local' as const, ...(imported ? { carryover: imported.carryover } : {}) };
  });
  localQueue = run.catch(() => undefined);
  return run;
}
