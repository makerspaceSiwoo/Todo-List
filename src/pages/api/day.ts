import type { APIRoute } from 'astro';
import { validDate, validOperation } from '../../lib/schedule';
import { accessDay } from '../../lib/storage';

export const prerender = false;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export const ALL: APIRoute = async ({ request, url }) => {
  if (request.method !== 'GET' && request.method !== 'PATCH') return json({ error: '지원하지 않는 요청입니다.' }, 405);
  const date = url.searchParams.get('date') || '';
  if (!validDate(date)) return json({ error: '올바른 날짜를 선택해 주세요.' }, 400);
  try {
    if (request.method === 'GET') return json(await accessDay(date));
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return json({ error: '허용되지 않은 요청입니다.' }, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON 형식이 필요합니다.' }, 415);
    const body = await request.text();
    if (body.length > 4096) return json({ error: '요청이 너무 큽니다.' }, 413);
    let operation: unknown;
    try { operation = JSON.parse(body); } catch { return json({ error: '올바른 JSON 형식이 필요합니다.' }, 400); }
    if (!validOperation(operation)) return json({ error: '올바르지 않은 변경 요청입니다.' }, 400);
    return json(await accessDay(date, operation));
  } catch (error) {
    console.error('Schedule storage:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: error instanceof Error ? error.message : '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
  }
};
