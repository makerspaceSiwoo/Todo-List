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
