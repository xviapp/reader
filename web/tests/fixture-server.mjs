import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const assetRoot = fileURLToPath(new URL('../../dist/lan-web/', import.meta.url));
const manifest = JSON.parse(readFileSync(`${assetRoot}manifest.json`, 'utf8'));
const streams = new Map();
let title, seq, reads, writes, deleted, live, saved, delay, beforeReady;
function reset() {
  title = '局域网阅读测试'; seq = 0; reads = 0; writes = 0; deleted = false; live = null; saved = '中文回答'; delay = 0; beforeReady = 0;
}
reset();
const stamp = '2026-09-08T10:00:00.000Z';
const source = { passageId: 'passage', bookId: 'book', title: '涌现与整体', sourceRevision: 1, currentRevision: 2, state: 'updated' };
const pageOf = (items) => ({ items, nextCursor: null });
const book = () => ({ id: 'book', title, authors: ['测试作者'], status: 'reading', progress: 42, updatedAt: stamp,
  coverId: null, createdAt: stamp, isbn: '9780000000000', publisher: '阅读出版社', publishedAt: '2026', summary: '一本关于整体与联系的书。', note: '留一点时间思考。', passageCount: 1, discussionCount: 1 });
const passage = () => ({ id: 'passage', bookId: 'book', bookTitle: title, title: '涌现与整体', pageLabel: '第 42 页', imageId: 'fixture-image',
  sourcePreview: '复杂系统的整体行为', rawSourceText: '复杂系统的整体行为不能简单还原为组成部分。', sourceText: '整体行为从局部互动中涌现。',
  summary: '## 从局部到整体\n\n一个简单的公式：$E=mc^2$。\n\n| 局部 | 整体 |\n|---|---|\n| 互动 | 涌现 |\n\n<script>alert(1)</script>\n\n![外部图片](https://invalid.example/tracker.png)\n\n[危险链接](javascript:alert(1))',
  summaryPreview: '整体行为从局部互动中涌现。', suggestedQuestions: ['局部如何形成整体？'], sourceRevision: 2, analysisStatus: 'completed', organizationStatus: 'completed', discussionCount: 1, createdAt: stamp, updatedAt: stamp });
const discussion = () => ({ id: 'discussion', title: '为什么整体大于部分之和？', bookId: 'book', bookTitle: title, folderId: 'folder', unread: true,
  lastMessagePreview: saved, lastMessageStatus: live ? 'pending' : 'completed', lastMessageAt: stamp, createdAt: stamp, updatedAt: stamp, sources: [source] });
const message = (id = 'message') => ({ id, discussionId: 'discussion', discussionTitle: discussion().title, bookId: 'book', role: 'assistant',
  content: id === 'message' ? live ? '' : saved : `历史回答 ${id}\n\n${'保留阅读位置。'.repeat(16)}`, hasMoreContent: false,
  status: id === 'message' && live ? 'pending' : 'completed', favorite: id === 'message', createdAt: stamp, updatedAt: stamp, sources: [source] });
function emit(name, data, scope = null) {
  for (const [response, subscription] of streams) if (!scope || subscription.discussionId === scope) {
    response.write(`: event\r\nevent: ${name}\r\ndata: ${JSON.stringify({ serviceId: 'fixture-service', changeSeq: seq, ...data })}\r\n\r\n`);
  }
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4173');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  const json = (data) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ protocolVersion: 1, serviceId: 'fixture-service', data })); };
  const fail = (status, code) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ error: { code } })); };
  if (url.pathname === '/__fixture/reset') { reset(); json({}); return; }
  if (url.pathname === '/__fixture/state') { json({ reads, writes, beforeReady, subscriptions: streams.size }); return; }
  if (url.pathname === '/__fixture/change') {
    title = url.searchParams.get('title') ?? title; deleted = url.searchParams.get('deleted') === '1'; seq++;
    emit('invalidate', {}); json({}); return;
  }
  if (url.pathname === '/__fixture/delay') { delay = 500; json({}); return; }
  if (url.pathname === '/__fixture/live') {
    const action = url.searchParams.get('action');
    if (action === 'start') {
      live = { messageId: 'message', discussionId: 'discussion', generationId: url.searchParams.get('generation') ?? 'generation-1', text: '已经收到的前缀😀', version: 1, state: 'generating', previewAvailable: true };
      emit('reply-state', { ...live, state: 'generating', type: 'reply-state' }, 'discussion'); seq++; emit('invalidate', {});
    } else if (action === 'complete') {
      saved = live?.text ?? saved; const previous = live; live = null; seq++;
      emit('reply-state', { ...previous, state: 'completed', version: (previous?.version ?? 0) + 1 }, 'discussion'); emit('invalidate', {});
    } else if (live) {
      const delta = url.searchParams.get('text') ?? '继续';
      const event = { type: 'reply-delta', messageId: 'message', discussionId: 'discussion', generationId: live.generationId, version: live.version + 1, offset: live.text.length, delta };
      if (action === 'late') event.generationId = 'old-generation';
      else { live.text += delta; live.version++; }
      if (action === 'gap') event.offset += 5;
      emit('reply-delta', event, 'discussion');
      if (action === 'duplicate') emit('reply-delta', event, 'discussion');
    }
    json({}); return;
  }
  if (url.pathname === '/api/v1/session') {
    if (request.method === 'POST') {
      let body = ''; for await (const part of request) body += part;
      if (JSON.parse(body).code !== '012345') { fail(401, 'INVALID_CODE'); return; }
      response.setHeader('Set-Cookie', 'fixture=1; HttpOnly; SameSite=Strict; Path=/'); json({ authenticated: true }); return;
    }
    if (request.method === 'DELETE') {
      response.setHeader('Set-Cookie', 'fixture=; Max-Age=0; Path=/'); for (const stream of streams.keys()) stream.end(); json({ authenticated: false }); return;
    }
    json({ authenticated: request.headers.cookie?.includes('fixture=1') === true }); return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (!request.headers.cookie?.includes('fixture=1')) { fail(401, 'AUTH_REQUIRED'); return; }
    if (request.method !== 'GET') { writes++; fail(405, 'METHOD_NOT_ALLOWED'); return; }
  }
  if (url.pathname === '/api/v1/events') {
    const pageId = url.searchParams.get('pageId');
    for (const [stream, subscription] of streams) if (subscription.pageId === pageId) stream.end();
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders();
    streams.set(response, { pageId, discussionId: url.searchParams.get('discussionId') });
    response.write('event: ready\r\ndata: {"protocolVersion":1,"serviceId":"fixture-service",\r\ndata: "connectionId":"connection","changeSeq":0}\r\n\r\n');
    const timer = setInterval(() => response.write('event: heartbeat\ndata: {"serviceId":"fixture-service","changeSeq":0,"sourceReady":true}\n\n'), 1000);
    request.on('close', () => { clearInterval(timer); streams.delete(response); }); return;
  }
  if (url.pathname.startsWith('/api/')) {
    reads++;
    const pageId = request.headers['x-reader-page-id'] ?? url.searchParams.get('pageId');
    if (![...streams.values()].some((subscription) => subscription.pageId === pageId)) { beforeReady++; fail(409, 'PAGE_NOT_CONNECTED'); return; }
    if (url.pathname.startsWith('/api/v1/media/')) {
      if (deleted) { fail(404, 'NOT_FOUND'); return; }
      response.setHeader('Content-Type', 'image/png'); response.end(readFileSync(new URL('../../assets/brand/icon.png', import.meta.url))); return;
    }
    let value;
    if (url.pathname === '/api/v1/books') value = pageOf(deleted || url.searchParams.get('status') === 'finished' ? [] : [book()]);
    else if (url.pathname === '/api/v1/folders') value = [{ id: 'folder', name: '科学与思考', position: 0 }];
    else if (url.pathname === '/api/v1/favorites') value = pageOf(deleted ? [] : [message()]);
    else if (url.pathname === '/api/v1/search') value = pageOf(deleted ? [] : [{ kind: 'passage', id: 'passage', bookId: 'book', discussionId: null, title: '涌现与整体', subtitle: title, snippet: '复杂系统的整体行为', match: 'source', imageId: 'fixture-image' }]);
    else if (deleted) { fail(404, 'NOT_FOUND'); return; }
    else if (url.pathname === '/api/v1/books/book') value = book();
    else if (url.pathname === '/api/v1/books/book/passages') value = pageOf([passage()]);
    else if (url.pathname === '/api/v1/passages/passage') value = passage();
    else if (url.pathname === '/api/v1/discussions') value = pageOf(url.searchParams.get('folderId') === 'ungrouped' ? [] : [discussion()]);
    else if (url.pathname === '/api/v1/discussions/discussion') value = discussion();
    else if (url.pathname === '/api/v1/discussions/discussion/messages') value = url.searchParams.has('cursor') ? pageOf([message('older')]) : { items: [...Array.from({ length: 6 }, (_, index) => message(`history-${index}`)), message()], nextCursor: 'older' };
    else if (url.pathname.startsWith('/api/v1/messages/')) value = message(url.pathname.split('/').at(-1));
    else if (url.pathname === '/api/v1/live-replies') value = live ? [{ ...live }] : [];
    else { fail(404, 'NOT_FOUND'); return; }
    if (delay && url.pathname === '/api/v1/books') { const duration = delay; delay = 0; await new Promise((resolve) => setTimeout(resolve, duration)); }
    json(value); return;
  }
  const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!Object.hasOwn(manifest.files, asset)) { response.writeHead(404).end(); return; }
  const extension = asset.split('.').at(-1);
  response.setHeader('Content-Type', { html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' }[extension] ?? 'application/octet-stream');
  response.end(readFileSync(`${assetRoot}${asset}`));
});
server.listen(4173, '127.0.0.1');
