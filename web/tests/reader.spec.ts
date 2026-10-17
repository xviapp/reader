import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.get('/__fixture/reset'); });

async function enterCode(page: Page) {
  await expect(page.locator('.code-input').first()).toBeVisible();
  await page.keyboard.type('012345');
}

async function login(page: Page) {
  await page.goto('/'); await enterCode(page);
  await expect(page.locator('.book h3')).toHaveText('局域网阅读测试');
}

test('access code uses six boxes and authenticates after direct numeric typing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.code-input')).toHaveCount(6);
  await page.locator('.code-input').first().blur();
  const loginRequest = page.waitForRequest((request) => request.url().endsWith('/api/v1/session') && request.method() === 'POST');
  await page.keyboard.type('012345');
  expect((await loginRequest).postDataJSON()).toEqual({ code: '012345' });
  await expect(page.locator('.book h3')).toHaveText('局域网阅读测试');
});

test('auth precedes business reads; SSE refresh keeps local preferences and never writes', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByLabel('6 位访问码')).toBeVisible();
  expect((await (await request.get('/__fixture/state')).json()).data.reads).toBe(0);
  await enterCode(page);
  await expect(page.getByRole('heading', { name: '局域网阅读测试' })).toBeVisible();
  await page.getByLabel('字号').selectOption('20');
  await request.get('/__fixture/change?title=中文更新');
  await expect(page.getByRole('heading', { name: '中文更新' })).toBeVisible();
  await expect(page.getByLabel('字号')).toHaveValue('20');
  await expect(page.getByText('只读', { exact: true })).toBeVisible();
  expect((await (await request.get('/__fixture/state')).json()).data.writes).toBe(0);
  expect(await page.evaluate(async () => ({ local: localStorage.length, cache: await caches.keys(), workers: (await navigator.serviceWorker.getRegistrations()).length })))
    .toEqual({ local: 0, cache: [], workers: 0 });
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '中文更新' })).not.toBeVisible();
});

test('narrow windows show long titles safely, without executing HTML', async ({ page, request }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await request.get('/__fixture/change?title=' + encodeURIComponent('<img src=x onerror=alert(1)> 很长的中文书名'.repeat(8)));
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.goto('/'); await enterCode(page);
  await expect(page.locator('.book h3')).toContainText('<img src=x onerror=alert(1)>');
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('disconnect preserves already read content and reconnect calibrates it', async ({ page, context, request }) => {
  await page.goto('/'); await enterCode(page);
  await expect(page.locator('.book h3')).toHaveText('局域网阅读测试');
  await context.setOffline(true);
  await expect(page.getByRole('alert')).toContainText('可能过期', { timeout: 18000 });
  await expect(page.locator('.book h3')).toHaveText('局域网阅读测试');
  await request.get('/__fixture/change?title=重连后的内容');
  await context.setOffline(false);
  await expect(page.locator('.book h3')).toHaveText('重连后的内容', { timeout: 20000 });
});

test('reads books, image excerpts, local math, sources, folders, favorites and Chinese search with HTTP copy fallback', async ({ page, request }, testInfo) => {
  const remoteRequests: string[] = []; const errors: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('blob:')) remoteRequests.push(request.url()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }));
  await login(page);
  await page.locator('.book .item-main').click();
  await expect(page.getByRole('heading', { name: '关于这本书' })).toBeVisible();
  await page.getByRole('button', { name: /第 42 页/ }).click();
  await expect(page.getByRole('heading', { name: '理解与摘要' })).toBeVisible();
  await expect(page.locator('.katex')).toBeVisible();
  await expect(page.getByRole('cell', { name: '涌现', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '放大涌现与整体原图' }).click();
  await page.getByLabel('缩放').fill('150');
  await expect(page.getByRole('dialog').getByRole('img')).toHaveCSS('max-width', 'none');
  await page.getByRole('button', { name: '关闭图片' }).click();
  await page.getByRole('button', { name: '复制摘要' }).click();
  await expect(page.getByRole('dialog', { name: '手动复制' })).toBeVisible();
  expect(await page.getByLabel('待复制文本').evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart)).toBeGreaterThan(20);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByText('查看文本 · 版本 2', { exact: true }).click();
  await expect(page.getByText('复杂系统的整体行为不能简单还原为组成部分。', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reader-desktop.png'), fullPage: true });
  await page.getByRole('navigation').getByRole('button', { name: '全部讨论' }).click();
  await page.getByLabel('文件夹').selectOption('folder');
  await page.getByRole('button', { name: /为什么整体大于部分之和/ }).click();
  await expect(page.getByText('引用版本 1 · 原文已更新至 2', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('中文回答', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: '加载更早消息' }).click();
  await expect(page.locator('#message-older')).toBeAttached();
  await page.getByRole('navigation').getByRole('button', { name: '收藏', exact: true }).click();
  await page.locator('.collection .item-main').click();
  await expect(page.getByRole('heading', { name: '阅读伙伴的回答' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByLabel('搜索内容').fill('复杂系统');
  await expect(page.getByText('摘录 · 命中原文', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /摘录 · 命中原文/ }).click();
  await expect(page.getByRole('heading', { name: '理解与摘要' })).toBeVisible();
  expect(remoteRequests).toEqual([]); expect(errors).toEqual([]);
  expect((await (await request.get('/__fixture/state')).json()).data).toMatchObject({ writes: 0, beforeReady: 0 });
});

test('calibrates an invalidation during an in-flight read and clears a deleted detail', async ({ page, request }) => {
  await login(page); await request.get('/__fixture/delay');
  const pending = page.waitForRequest((request) => request.url().endsWith('/api/v1/books'));
  await request.get('/__fixture/change?title=中间值'); await pending;
  await request.get('/__fixture/change?title=最终值');
  await expect(page.locator('.book h3')).toHaveText('最终值');
  await page.locator('.book .item-main').click();
  await expect(page.getByRole('heading', { name: '关于这本书' })).toBeVisible();
  await request.get('/__fixture/change?deleted=1');
  await expect(page.locator('.detail')).toContainText('内容已删除或不可访问');
  await expect(page.getByRole('heading', { name: '关于这本书' })).not.toBeVisible();
});

test('reconciles live prefixes, duplicate and missing deltas, retry generations and persisted completion without scrolling history', async ({ page, request }) => {
  await request.get('/__fixture/live?action=start'); await login(page);
  await page.getByRole('navigation').getByRole('button', { name: '全部讨论' }).click();
  await page.getByRole('button', { name: /为什么整体大于部分之和/ }).click();
  await expect(page.locator('#message-message .live-text')).toHaveText('已经收到的前缀😀');
  await request.get('/__fixture/live?action=duplicate&text=下一段');
  await expect(page.locator('#message-message .live-text')).toHaveText('已经收到的前缀😀下一段');
  await request.get('/__fixture/live?action=gap&text=补齐缺口');
  await expect(page.locator('#message-message .live-text')).toHaveText('已经收到的前缀😀下一段补齐缺口');
  await page.locator('.discussion-scroll').evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await request.get('/__fixture/live?action=delta&text=最新内容');
  await expect(page.getByRole('button', { name: /有更新 · 回到最新消息/ })).toBeVisible();
  expect(await page.locator('.discussion-scroll').evaluate((element) => element.scrollTop)).toBe(0);
  await request.get('/__fixture/live?action=start&generation=generation-2');
  await expect(page.locator('#message-message .live-text')).toHaveText('已经收到的前缀😀');
  await request.get('/__fixture/live?action=late&text=不应显示');
  await expect(page.locator('#message-message .live-text')).toHaveText('已经收到的前缀😀');
  await request.get('/__fixture/live?action=complete');
  await expect(page.locator('#message-message .live-status')).not.toBeVisible();
  await expect(page.locator('#message-message .prose')).toHaveText('已经收到的前缀😀');
  expect((await (await request.get('/__fixture/state')).json()).data).toMatchObject({ writes: 0, beforeReady: 0 });
});

test('narrow reading navigation preserves the list and supports dark mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 900 }); await login(page);
  await page.getByRole('button', { name: '深色主题' }).click();
  await page.locator('.book .item-main').click();
  await expect(page.getByRole('heading', { name: '关于这本书' })).toBeVisible();
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await page.getByRole('button', { name: /第 42 页/ }).click();
  await expect(page.getByRole('heading', { name: '理解与摘要' })).toBeAttached();
  await expect(page.getByRole('button', { name: '放大涌现与整体原图' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('reader-narrow-dark.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '← 返回列表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '涌现与整体', exact: true })).toBeVisible();
});
