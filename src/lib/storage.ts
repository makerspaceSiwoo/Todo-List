import { emptyDay, applyOperation, type Day, type Operation } from './schedule';

type Fields = Record<string, string>;
function redisConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || import.meta.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || import.meta.env.KV_REST_API_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN || import.meta.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || import.meta.env.KV_REST_API_TOKEN,
  };
}
function fromFields(date: string, fields: Fields): Day {
  const day = emptyDay(date);
  for (let i = 0; i < 10; i++) {
    day.tasks[i] = { text: fields[`text:${i}`] ?? '', done: fields[`done:${i}`] === 'true' };
  }
  for (let i = 0; i < 34; i++) day.slots[i] = fields[`slot:${i}`] || null;
  day.revision = Number(fields.revision || 0);
  day.updatedAt = fields.updatedAt || null;
  return day;
}
function fieldsFor(op: Operation): Fields {
  if (op.type === 'slots') return Object.fromEntries(op.indices.map(index => [`slot:${index}`, op.value ?? '']));
  return { [`${op.type}:${op.index}`]: String(op.value) };
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
const UPDATE_SCRIPT = `
for i = 1, #ARGV - 1, 2 do redis.call('HSET', KEYS[1], ARGV[i], ARGV[i + 1]) end
redis.call('HINCRBY', KEYS[1], 'revision', 1)
return redis.call('HGETALL', KEYS[1])
`;
let localQueue: Promise<unknown> = Promise.resolve();
export async function accessDay(date: string, op?: Operation): Promise<{ day: Day; storage: 'local' | 'cloud' }> {
  const { url, token } = redisConfig();
  const namespace = process.env.SCHEDULE_NAMESPACE || import.meta.env.SCHEDULE_NAMESPACE || process.env.VERCEL_ENV || import.meta.env.VERCEL_ENV || 'development';
  if (url && token) {
    const key = `daypiece:${namespace}:${date}`;
    const command = op ? ['EVAL', UPDATE_SCRIPT, 1, key, ...Object.entries({ ...fieldsFor(op), updatedAt: new Date().toISOString() }).flat()] : ['HGETALL', key];
    const result = await redis(command);
    // REST HGETALL can return an object; Lua HGETALL returns an alternating array.
    const fields = Array.isArray(result) ? Object.fromEntries(Array.from({ length: result.length / 2 }, (_, i) => [result[i * 2], String(result[i * 2 + 1])])) : (result || {}) as Fields;
    return { day: fromFields(date, fields), storage: 'cloud' };
  }
  if (!import.meta.env.DEV || process.env.VERCEL) throw new Error('공유 저장소 설정이 필요합니다. Vercel에서 Upstash Redis 환경 변수를 연결해 주세요.');
  // Development only: durable local file, serialized read/modify/write.
  const run = localQueue.then(async () => {
    const { mkdir, readFile, writeFile, rename } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const directory = resolve(process.env.SCHEDULE_DATA_DIR || '.data', namespace);
    const file = resolve(directory, `${date}.json`);
    await mkdir(directory, { recursive: true });
    let day: Day;
    try { day = JSON.parse(await readFile(file, 'utf8')) as Day; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; day = emptyDay(date); }
    if (op) {
      day = applyOperation(day, op);
      day.revision++;
      day.updatedAt = new Date().toISOString();
      await writeFile(`${file}.tmp`, JSON.stringify(day));
      await rename(`${file}.tmp`, file);
    }
    return { day, storage: 'local' as const };
  });
  localQueue = run.catch(() => undefined);
  return run;
}
