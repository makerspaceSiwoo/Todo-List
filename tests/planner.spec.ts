import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

function testDate() { return new Date(Date.UTC(2036, 0, test.info().line * 3)).toISOString().slice(0, 10); }
async function openDay(page: Page, date: string) {
  await page.goto('/');
  await expect(page.locator('[data-input="0"]')).toBeEnabled();
  await page.locator('#date').fill(date);
  await page.locator('#date').dispatchEvent('change');
  await expect(page.locator('#date')).toHaveValue(date);
  await expect(page.locator('[data-input="0"]')).toBeEnabled();
}
async function readDay(request: APIRequestContext, date: string) {
  return (await (await request.get(`/api/day?date=${date}`)).json()).day;
}
async function slotPoint(page: Page, index: number) {
  await page.locator(`[data-slot="${index}"]`).scrollIntoViewIfNeeded();
  const box = await page.locator(`[data-slot="${index}"]`).boundingBox();
  if (!box) throw new Error('Missing schedule cell');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function hold(page: Page, index: number) {
  const p = await slotPoint(page, index);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(360);
  await page.mouse.up();
}
async function drag(page: Page, from: number, to: number) {
  const start = await slotPoint(page, from);
  const end = await slotPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

test('17 hours, ten unique colors, ordered labels, and full-hour click toggle', async ({ page, request }) => {
  const date = testDate();
  await openDay(page, date);
  await expect(page.locator('.time-row')).toHaveCount(17);
  await expect(page.locator('.time-cell')).toHaveCount(34);
  await expect(page.locator('.task-check')).toHaveCount(10);
  expect(await page.locator('.task-select').allTextContents()).toEqual(['a','b','c','d','e','가','나','다','라','마']);
  expect(await page.locator('.task-block').evaluateAll(items => new Set(items.map(item => getComputedStyle(item).backgroundColor)).size)).toBe(10);
  await page.locator('[data-input="0"]').fill('기획서 작성');
  await page.locator('[data-slot="1"]').click();
  await expect(page.locator('[data-slot="0"]')).toHaveAttribute('data-filled','true');
  await expect(page.locator('[data-slot="1"]')).toHaveAttribute('data-filled','true');
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,2)).toEqual(['task-0','task-0']);
  await page.locator('[data-slot="0"]').click();
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,2)).toEqual([null,null]);
});

test('hold selects either half, overwrites another task, and toggles only that half', async ({ page, request }) => {
  const date = testDate();
  await openDay(page,date);
  await page.locator('[data-select="0"]').click();
  await hold(page,1);
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,2)).toEqual([null,'task-0']);
  await page.locator('[data-select="1"]').click();
  await hold(page,0);
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,2)).toEqual(['task-1','task-0']);
  await hold(page,1);
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,2)).toEqual(['task-1','task-1']);
  await hold(page,1);
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,2)).toEqual(['task-1',null]);
});

test('drag fills continuous chronological range and erases in reverse', async ({ page, request }) => {
  const date = testDate();
  await openDay(page,date);
  await page.locator('[data-select="2"]').click();
  await drag(page,1,6);
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,8)).toEqual([null,...Array(6).fill('task-2'),null]);
  await drag(page,5,2);
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,8)).toEqual([null,'task-2',null,null,null,null,'task-2',null]);
});

test('shrinking a drag restores cells outside its final range; cancel discards it', async ({ page, request }) => {
  const date = testDate();
  await openDay(page,date);
  await page.locator('#other').click();
  const start = await slotPoint(page,0);
  const far = await slotPoint(page,7);
  const end = await slotPoint(page,2);
  await page.mouse.move(start.x,start.y);
  await page.mouse.down();
  await page.mouse.move(far.x,far.y,{steps:8});
  await page.mouse.move(end.x,end.y,{steps:5});
  await page.mouse.up();
  await expect.poll(async () => (await readDay(request,date)).slots.slice(0,8)).toEqual(['other','other','other',null,null,null,null,null]);
  await page.mouse.move(far.x,far.y);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await page.locator('#timetable').dispatchEvent('pointercancel');
  await page.mouse.up();
  await expect(page.locator('[data-slot="7"]')).toHaveAttribute('data-filled','false');
});

test('completion grays schedule, strikes task, and restores its color when unchecked', async ({ page, request }) => {
  const date = testDate();
  await openDay(page,date);
  const input = page.locator('[data-input="5"]');
  await input.fill('책 읽기');
  await page.locator('[data-slot="10"]').click();
  const cell = page.locator('[data-slot="10"]');
  const color = await page.locator('[data-task="5"] .task-block').evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(cell).toHaveCSS('background-color',color);
  await page.locator('[data-check="5"]').check();
  await expect(cell).toHaveAttribute('data-done','true');
  await expect(cell).toHaveCSS('background-color','rgb(236, 238, 242)');
  await expect(input).toHaveCSS('text-decoration-line','line-through');
  await expect(page.locator('#task-count')).toHaveText('1 / 1 완료');
  await expect.poll(async () => (await readDay(request,date)).tasks[5].done).toBe(true);
  await page.locator('[data-check="5"]').uncheck();
  await expect(cell).toHaveAttribute('data-done','false');
  await expect(cell).toHaveCSS('background-color',color);
});

test('lock blocks mouse and keyboard edits and survives reload', async ({ page, request }) => {
  const date = testDate();
  await openDay(page,date);
  await page.locator('#other').click();
  await page.locator('[data-slot="0"]').click();
  await expect.poll(async () => (await readDay(request,date)).slots[0]).toBe('other');
  await page.locator('#lock').check();
  await expect(page.locator('[data-slot="0"]')).toBeDisabled();
  const p = await slotPoint(page,0);
  await page.mouse.click(p.x,p.y);
  expect((await readDay(request,date)).slots[0]).toBe('other');
  await page.reload();
  await expect(page.locator('#lock')).toBeChecked();
  await expect(page.locator('[data-slot="0"]')).toBeDisabled();
});

test('independent browser contexts share data and concurrent field updates survive', async ({ browser, request }) => {
  const date = testDate();
  const first = await browser.newContext();
  const second = await browser.newContext();
  const a = await first.newPage();
  const b = await second.newPage();
  await openDay(a,date);
  await openDay(b,date);
  await Promise.all([a.locator('[data-input="0"]').fill('컴퓨터 A'),b.locator('[data-input="9"]').fill('컴퓨터 B')]);
  await expect.poll(async () => (await readDay(request,date)).tasks.map((task: {text:string})=>task.text)).toEqual(['컴퓨터 A','','','','','','','','','컴퓨터 B']);
  await expect(a.locator('[data-input="9"]')).toHaveValue('컴퓨터 B',{timeout:10000});
  await expect(b.locator('[data-input="0"]')).toHaveValue('컴퓨터 A',{timeout:10000});
  await first.close();
  await second.close();
});

test('failed saves stay pending, show an error, and retry without losing edits', async ({ page, request }) => {
  const date = testDate();
  await openDay(page,date);
  await page.route('**/api/day?*',async route => {
    if (route.request().method()==='PATCH') await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'테스트 저장 실패'})});
    else await route.continue();
  });
  await page.locator('[data-input="0"]').fill('다시 저장할 일');
  await expect(page.locator('#retry')).toBeVisible();
  await expect(page.locator('#connection-notice')).toContainText('저장 대기');
  expect((await readDay(request,date)).tasks[0].text).toBe('');
  await page.unroute('**/api/day?*');
  await page.locator('#retry').click();
  await expect.poll(async () => (await readDay(request,date)).tasks[0].text).toBe('다시 저장할 일');
});

test('keyboard activation and date isolation', async ({ page, request }) => {
  const date = testDate();
  await openDay(page,date);
  await page.locator('[data-select="3"]').click();
  const cell = page.locator('[data-slot="4"]');
  await cell.focus();
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await readDay(request,date)).slots.slice(4,6)).toEqual(['task-3',null]);
  await page.keyboard.press('Shift+Enter');
  await expect.poll(async () => (await readDay(request,date)).slots.slice(4,6)).toEqual(['task-3','task-3']);
  await page.locator('#next-day').click();
  await expect(page.locator('[data-slot="4"]')).toHaveAttribute('data-filled','false');
  await page.locator('#prev-day').click();
  await expect(page.locator('[data-slot="4"]')).toHaveAttribute('data-filled','true');
});

test('API rejects invalid operations, dates, and cross-origin writes', async ({ request }) => {
  expect((await request.get('/api/day?date=2036-02-31')).status()).toBe(400);
  const url = `/api/day?date=${testDate()}`;
  for (const data of [{type:'slots',indices:[34],value:'other'},{type:'slots',indices:[0],value:'unknown'},{type:'done',index:10,value:true},{type:'text',index:0,value:'x'.repeat(201)}]) {
    expect((await request.patch(url,{data})).status()).toBe(400);
  }
  expect((await request.patch(url,{data:{type:'done',index:0,value:true},headers:{origin:'https://example.com'}})).status()).toBe(403);
});

test('mobile layout fits viewport and touch supports a half-hour hold', async ({ browser }) => {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page = await context.newPage();
  await openDay(page,testDate());
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('#other').tap();
  const cell = page.locator('[data-slot="0"]');
  await cell.scrollIntoViewIfNeeded();
  const p = await slotPoint(page,0);
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y}]});
  await page.waitForTimeout(360);
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(cell).toHaveAttribute('data-filled','true');
  await expect(page.locator('[data-slot="1"]')).toHaveAttribute('data-filled','false');
  await context.close();
});

async function changeTask(request: APIRequestContext, date: string, index: number, text: string, done = false) {
  for (const data of [{ type: 'text', index, value: text }, { type: 'done', index, value: done }]) {
    expect((await request.patch(`/api/day?date=${date}`, { data })).ok()).toBe(true);
  }
}
function before(date: string, days = 1) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

test('carryover imports only the chosen group of yesterday unfinished tasks and remains editable', async ({ page, request }) => {
  const date = testDate();
  const yesterday = before(date);
  await changeTask(request, yesterday, 0, '어제 직장 미완료');
  await changeTask(request, yesterday, 1, '어제 직장 완료', true);
  await changeTask(request, yesterday, 2, '   ');
  await changeTask(request, yesterday, 3, '어제 직장 미완료');
  await changeTask(request, yesterday, 4, '어제 또 다른 작업');
  await changeTask(request, yesterday, 5, '어제 개인 미완료');
  await changeTask(request, yesterday, 6, '어제 개인 완료', true);
  await changeTask(request, before(date, 2), 2, '이틀 전 작업');
  await changeTask(request, date, 0, '오늘 이미 작성한 작업');
  await changeTask(request, date, 1, '', true);
  await request.patch(`/api/day?date=${yesterday}`, { data: { type: 'slots', indices: [0, 1], value: 'task-0' } });
  const original = await readDay(request, yesterday);
  await openDay(page, date);
  await page.locator('[data-carryover="work"]').click();
  await expect(page.locator('#carryover-status-work')).toContainText('2개를 가져왔어요');
  await expect(page.locator('[data-input="0"]')).toHaveValue('오늘 이미 작성한 작업');
  await expect(page.locator('[data-input="1"]')).toHaveValue('어제 직장 미완료');
  await expect(page.locator('[data-check="1"]')).not.toBeChecked();
  await expect(page.locator('[data-input="2"]')).toHaveValue('어제 또 다른 작업');
  await expect(page.locator('[data-input="3"]')).toHaveValue('');
  await expect(page.locator('[data-input="5"]')).toHaveValue('');
  expect((await readDay(request, date)).slots.every((slot: string | null) => slot === null)).toBe(true);
  await page.locator('[data-carryover="work"]').click();
  await expect(page.locator('#carryover-status-work')).toContainText('이미 목록에 있어요');
  await page.locator('[data-carryover="personal"]').click();
  await expect(page.locator('[data-input="5"]')).toHaveValue('어제 개인 미완료');
  await expect(page.locator('[data-input="6"]')).toHaveValue('');
  await page.locator('[data-input="1"]').fill('가져온 뒤 수정한 작업');
  await page.locator('[data-input="1"]').blur();
  await expect.poll(async () => (await readDay(request, date)).tasks[1].text).toBe('가져온 뒤 수정한 작업');
  expect(await readDay(request, yesterday)).toEqual(original);
});

test('carryover stops at yesterday when it is empty and never falls back to older days', async ({ page, request }) => {
  const date = testDate();
  await changeTask(request, before(date, 2), 0, '이틀 전 직장 작업');
  await changeTask(request, before(date, 3), 5, '사흘 전 개인 작업');
  await openDay(page, date);
  for (const group of ['work', 'personal']) {
    await page.locator(`[data-carryover="${group}"]`).click();
    await expect(page.locator(`#carryover-status-${group}`)).toHaveText('어제 미완료 작업이 없어요.');
  }
  expect((await readDay(request, date)).tasks.every((task: { text: string }) => !task.text)).toBe(true);
});

test('carryover grows full and partial lists and concurrent calls do not duplicate tasks', async ({ page, request }) => {
  const date = testDate();
  for (let i = 0; i < 5; i++) {
    await changeTask(request, date, i, `오늘 직장 ${i}`);
    await changeTask(request, before(date), i, `어제 직장 ${i}`);
  }
  await changeTask(request, date, 5, '중복 개인 작업');
  await changeTask(request, date, 6, '오늘 개인 1');
  await changeTask(request, date, 7, '오늘 개인 2');
  await changeTask(request, before(date), 5, '중복 개인 작업');
  await changeTask(request, before(date), 6, '개인 가져오기 1');
  await changeTask(request, before(date), 7, '개인 가져오기 2');
  await changeTask(request, before(date), 8, '개인 가져오기 3');
  await openDay(page, date);
  await page.locator('[data-carryover="work"]').click();
  await expect(page.locator('#carryover-status-work')).toContainText('5개를 가져왔어요');
  await expect(page.locator('[data-task-group="work"] .task-item')).toHaveCount(10);
  expect((await readDay(request, date)).tasks.slice(0, 5).map((task: { text: string }) => task.text)).toEqual(Array.from({ length: 5 }, (_, i) => `오늘 직장 ${i}`));
  const responses = await Promise.all(Array.from({ length: 2 }, () => request.patch(`/api/day?date=${date}`, { data: { type: 'carryover', group: 'personal' } })));
  const results = await Promise.all(responses.map(response => response.json()));
  expect(results.reduce((sum, result) => sum + result.carryover.imported, 0)).toBe(3);
  expect((await readDay(request, date)).extras.filter((task: { id: string }) => task.id.startsWith('personal-')).map((task: { text: string }) => task.text)).toEqual(['개인 가져오기 3']);
  expect((await readDay(request, date)).tasks.slice(5).map((task: { text: string }) => task.text)).toEqual(['중복 개인 작업', '오늘 개인 1', '오늘 개인 2', '개인 가져오기 1', '개인 가져오기 2']);
});

test('carryover saves a newly typed today task before importing and handles year boundaries', async ({ page, request }) => {
  const date = '2040-01-01';
  await changeTask(request, '2039-12-31', 0, '작년 마지막 날 미완료');
  await changeTask(request, '2039-12-30', 1, '이틀 전 제외');
  await openDay(page, date);
  await page.locator('[data-input="0"]').fill('방금 작성한 오늘 작업');
  await page.locator('[data-carryover="work"]').click();
  await expect(page.locator('#carryover-status-work')).toContainText('1개를 가져왔어요');
  await expect(page.locator('[data-input="0"]')).toHaveValue('방금 작성한 오늘 작업');
  await expect(page.locator('[data-input="1"]')).toHaveValue('작년 마지막 날 미완료');
  await expect(page.locator('[data-input="2"]')).toHaveValue('');
});

test('carryover response stays on its original day when navigating during import', async ({ page, request }) => {
  const date = testDate();
  await changeTask(request, before(date), 0, '날짜 이동 중 가져오기');
  await openDay(page, date);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/day?*', async route => {
    if (route.request().method() === 'PATCH' && route.request().postDataJSON().type === 'carryover') await gate;
    await route.continue();
  });
  await page.locator('[data-carryover="work"]').click();
  await expect(page.locator('[data-carryover="work"]')).toBeDisabled();
  await page.locator('#next-day').click();
  release();
  await expect.poll(async () => (await readDay(request, date)).tasks[0].text).toBe('날짜 이동 중 가져오기');
  await expect(page.locator('[data-input="0"]')).toHaveValue('');
  await expect(page.locator('#carryover-status-work')).toHaveText('');
  await page.locator('#prev-day').click();
  await expect(page.locator('[data-input="0"]')).toHaveValue('날짜 이동 중 가져오기');
  expect((await request.patch(`/api/day?date=${date}`, { data: { type: 'carryover', group: 'unknown' } })).status()).toBe(400);
});

async function addTask(page: Page, group: 'work' | 'personal') {
  const rows = page.locator(`[data-task-group="${group}"] [data-extra]`);
  const count = await rows.count();
  await page.locator(`[data-add="${group}"]`).click();
  await expect(rows).toHaveCount(count + 1);
  return (await rows.last().getAttribute('data-task'))!;
}

test('each group keeps five base rows and allows up to ten with a limit tooltip', async ({ page, request }) => {
  const date = testDate();
  await openDay(page, date);
  for (const group of ['work', 'personal'] as const) {
    await expect(page.locator(`[data-task-group="${group}"] .task-item`)).toHaveCount(5);
    await expect(page.locator(`[data-task-group="${group}"] [data-remove]`)).toHaveCount(0);
    for (let i = 0; i < 5; i++) await addTask(page, group);
    await expect(page.locator(`[data-add="${group}"]`)).toBeDisabled();
    await page.locator(`[data-add-control="${group}"]`).hover();
    await expect(page.locator(`#task-limit-${group}`)).toBeVisible();
    await expect(page.locator(`#task-limit-${group}`)).toHaveText('할 일은 최대 10개까지 생성 가능합니다');
  }
  await expect(page.locator('.task-item')).toHaveCount(20);
  await expect.poll(async () => (await readDay(request, date)).extras.length).toBe(10);
  const first = page.locator('[data-task-group="work"] [data-remove]').first();
  await first.click();
  await expect(page.locator('[data-add="work"]')).toBeEnabled();
  await expect(page.locator('[data-add="personal"]')).toBeDisabled();
  await expect(page.locator('[data-task-group="work"] .task-item')).toHaveCount(9);
  await addTask(page, 'work');
  await expect(page.locator('[data-add="work"]')).toBeDisabled();
  expect((await request.patch(`/api/day?date=${date}`, { data: { type: 'remove', id: 'task-0' } })).status()).toBe(400);
});

test('deleting an extra clears its schedule but preserves other IDs colors and completion', async ({ page, request }) => {
  const date = testDate();
  await openDay(page, date);
  const a = await addTask(page, 'work');
  await page.locator(`[data-input="${a}"]`).fill('삭제할 작업');
  await page.locator('[data-slot="0"]').click();
  const b = await addTask(page, 'work');
  await page.locator(`[data-input="${b}"]`).fill('유지할 작업');
  await page.locator('[data-slot="2"]').click();
  await page.locator(`[data-check="${b}"]`).check();
  const color = await page.locator(`[data-task="${b}"]`).evaluate(el => (el as HTMLElement).style.getPropertyValue('--task-color'));
  await page.locator(`[data-remove="${a}"]`).click();
  await expect(page.locator(`[data-task="${a}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-input="${b}"]`)).toHaveValue('유지할 작업');
  await expect(page.locator(`[data-check="${b}"]`)).toBeChecked();
  await expect(page.locator(`[data-select="${b}"]`)).toHaveText('f');
  expect(await page.locator(`[data-task="${b}"]`).evaluate(el => (el as HTMLElement).style.getPropertyValue('--task-color'))).toBe(color);
  await expect.poll(async () => (await readDay(request, date)).slots.slice(0, 4)).toEqual([null, null, b, b]);
  await request.patch(`/api/day?date=${date}`, { data: { type: 'extra-text', id: a, value: '삭제 후 오래된 편집' } });
  await request.patch(`/api/day?date=${date}`, { data: { type: 'slots', indices: [0], value: a } });
  const saved = await readDay(request, date);
  expect(saved.extras.some((task: { id: string }) => task.id === a)).toBe(false);
  expect(saved.slots[0]).toBe(null);
  await page.reload();
  await expect(page.locator('[data-input="0"]')).toBeEnabled();
  await page.locator('#date').fill(date);
  await page.locator('#date').dispatchEvent('change');
  await expect(page.locator(`[data-input="${b}"]`)).toHaveValue('유지할 작업');
});

test('carryover automatically creates two rows for seven unfinished tasks in each group', async ({ page, request }) => {
  const date = testDate();
  for (const group of ['work', 'personal'] as const) {
    const start = group === 'work' ? 0 : 5;
    for (let i = 0; i < 5; i++) await changeTask(request, before(date), start + i, `${group} 어제 ${i}`);
    for (let i = 5; i < 7; i++) {
      const id = `${group}-${crypto.randomUUID()}`;
      await request.patch(`/api/day?date=${before(date)}`, { data: { type: 'add', group, id } });
      await request.patch(`/api/day?date=${before(date)}`, { data: { type: 'extra-text', id, value: `${group} 어제 ${i}` } });
    }
  }
  await openDay(page, date);
  for (const group of ['work', 'personal'] as const) {
    await page.locator(`[data-carryover="${group}"]`).click();
    await expect(page.locator(`#carryover-status-${group}`)).toContainText('7개를 가져왔어요');
    await expect(page.locator(`[data-task-group="${group}"] .task-item`)).toHaveCount(7);
    await page.locator(`[data-carryover="${group}"]`).click();
    await expect(page.locator(`#carryover-status-${group}`)).toContainText('이미 목록에 있어요');
  }
  await expect(page.locator('.task-item')).toHaveCount(14);
  expect((await readDay(request, date)).extras.length).toBe(4);
});

test('server enforces ten per group under concurrent adds and carryover reports overflow', async ({ request }) => {
  const date = testDate();
  const ids = Array.from({ length: 9 }, () => `work-${crypto.randomUUID()}`);
  await Promise.all(ids.map(id => request.patch(`/api/day?date=${date}`, { data: { type: 'add', group: 'work', id } })));
  const saved = await readDay(request, date);
  expect(saved.extras).toHaveLength(5);
  for (let i = 0; i < 5; i++) await changeTask(request, date, i, `오늘 기본 ${i}`);
  for (const task of saved.extras) await request.patch(`/api/day?date=${date}`, { data: { type: 'extra-text', id: task.id, value: `오늘 추가 ${task.id}` } });
  await changeTask(request, before(date), 0, '가져오지 못할 작업');
  const response = await request.patch(`/api/day?date=${date}`, { data: { type: 'carryover', group: 'work' } });
  const result = await response.json();
  expect(result.carryover).toEqual({ imported: 0, remaining: 1, duplicates: 0, total: 1 });
  expect(result.day.extras).toHaveLength(5);
  expect((await request.patch(`/api/day?date=${date}`, { data: { type: 'add', group: 'personal', id: ids[0] } })).status()).toBe(400);
});

test('long timetable labels stay ellipsized within equal half-hour cells at every breakpoint', async ({ page }) => {
  for (const [offset, width] of [1280, 900, 390].entries()) {
    await page.setViewportSize({ width, height: 1000 });
    const date = new Date(`${testDate()}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    await openDay(page, date.toISOString().slice(0, 10));
    const cell = page.locator('[data-slot="0"]');
    const before = await cell.boundingBox();
    for (const [index, title] of [
      '아주 긴 작업 이름과 상세 설명을 시간표에 표시하는 경우 '.repeat(10).slice(0, 200),
      'VeryLongTaskNameWithoutAnySpaces'.repeat(8).slice(0, 200),
    ].entries()) {
      await page.locator('[data-input="0"]').fill(title);
      if (index === 0) await cell.click();
      const label = cell.locator('.cell-label');
      await expect(label).toHaveText(`a. ${title}`);
      const layout = await cell.evaluate(el => {
        const row = el.closest('.time-row')!.getBoundingClientRect();
        const cells = el.parentElement!.getBoundingClientRect();
        const left = el.getBoundingClientRect();
        const right = el.nextElementSibling!.getBoundingClientRect();
        const label = el.querySelector<HTMLElement>('.cell-label')!;
        return { width: left.width, rightWidth: right.width, rowRight: row.right, cellsRight: cells.right,
          documentWidth: document.documentElement.scrollWidth, viewport: innerWidth,
          clipped: label.scrollWidth > label.clientWidth, ellipsis: getComputedStyle(label).textOverflow };
      });
      expect(Math.abs(layout.width - before!.width), `viewport ${width}, title ${index}`).toBeLessThan(1);
      // The right cell has one extra border pixel; allow subpixel rounding.
      expect(Math.abs(layout.width - layout.rightWidth)).toBeLessThan(1.1);
      expect(layout.cellsRight).toBeLessThanOrEqual(layout.rowRight + 1);
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport);
      expect(layout.clipped).toBe(true);
      expect(layout.ellipsis).toBe('ellipsis');
      await expect(cell).toHaveAttribute('aria-label', new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});
