import { describe, expect, it } from 'vitest';

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  isSameReaderPage,
  readerRouteFromParams,
  readerRouteHref,
  resolveReaderBackAction,
  shouldShowReaderPrimaryPane,
  type ReaderDetailRoute,
} from '@/modules/reader/ui/navigation';

describe('Reader 返回导航', () => {
  it('子页统一返回原生导航栈的上一页', () => {
    expect(resolveReaderBackAction(false, true)).toBe('router-back');
  });

  it('直接打开的子页在没有历史时回到首页', () => {
    expect(resolveReaderBackAction(false, false)).toBe('home');
  });

  it('只有没有历史的首页交给系统退出', () => {
    expect(resolveReaderBackAction(true, false)).toBe('exit-app');
    expect(resolveReaderBackAction(true, true)).toBe('router-back');
  });
});

const routes: ReaderDetailRoute[] = [
  { name: 'search', bookId: null },
  { name: 'search', bookId: 'book-1' },
  { name: 'book', bookId: 'book-1', tab: 'passages' },
  { name: 'book', bookId: 'book-1', tab: 'favorites', endSession: true },
  { name: 'book-form', bookId: null },
  { name: 'book-form', bookId: 'book-1' },
  { name: 'book-trash', bookId: 'book-1' },
  { name: 'book-reading', bookId: 'book-1' },
  { name: 'passage-capture', bookId: 'book-1' },
  { name: 'reader-trash' },
  { name: 'passage', passageId: 'passage-1', tab: 'discussions' },
  { name: 'passage-source', passageId: 'passage-1' },
  { name: 'discussion-new', bookId: null, passageId: null, question: '' },
  { name: 'discussion-new', bookId: 'book-1', passageId: 'passage-1', question: '如何理解？\n& + / # ?' },
  { name: 'discussion', discussionId: 'discussion-1' },
  { name: 'discussion', discussionId: 'discussion-1', composerIntent: { id: 'intent-1', question: '新问题 & 后续？' }, focusMessageId: 'message-1' },
  { name: 'discussion-reader', discussionId: 'discussion-1', messageId: 'message-1' },
  { name: 'discussion-favorites' },
  { name: 'discussion-trash' },
];

describe('Reader 独立页面路由', () => {
  it.each(routes)('能够通过 URL 参数恢复 $name', (route) => {
    const href = readerRouteHref(route);
    const query = new URLSearchParams(Object.entries(href.params).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    expect(readerRouteFromParams(route.name, Object.fromEntries(new URLSearchParams(query.toString())))).toEqual(route);
    const file = fileURLToPath(new URL(`../app${href.pathname}.tsx`, import.meta.url));
    const index = fileURLToPath(new URL(`../app${href.pathname}/index.tsx`, import.meta.url));
    expect(existsSync(file) || existsSync(index)).toBe(true);
  });

  it('处理重复参数、缺省标签和无效标识', () => {
    expect(readerRouteFromParams('book', { bookId: ['book-1', 'book-2'], tab: 'unknown' })).toEqual({ name: 'book', bookId: 'book-1', tab: 'passages' });
    expect(readerRouteFromParams('passage', { passageId: 'passage-1' })).toEqual({ name: 'passage', passageId: 'passage-1', tab: 'questions' });
    expect(readerRouteFromParams('book', {})).toBeNull();
    expect(readerRouteFromParams('book-reading', { bookId: '' })).toBeNull();
    expect(readerRouteFromParams('discussion-reader', { discussionId: 'discussion-1' })).toBeNull();
  });

  it('标签切换和一次性请求不替换页面', () => {
    const book: ReaderDetailRoute = { name: 'book', bookId: 'book-1', tab: 'passages', endSession: true };
    expect(isSameReaderPage(book, { ...book, tab: 'favorites' })).toBe(true);
    expect(isSameReaderPage(book, { ...book, bookId: 'book-2' })).toBe(false);
    expect(isSameReaderPage(book, { name: 'book-form', bookId: 'book-1' })).toBe(false);
    expect(isSameReaderPage({ name: 'passage', passageId: 'p1', tab: 'questions' }, { name: 'passage', passageId: 'p1', tab: 'discussions' })).toBe(true);
    expect(isSameReaderPage(routes[15]!, { name: 'discussion', discussionId: 'discussion-1' })).toBe(true);
  });

  it('更新参数时显式清除已处理的临时请求', () => {
    expect(readerRouteHref({ name: 'book', bookId: 'book-1', tab: 'passages' }).params).toHaveProperty('endSession', undefined);
    const params = readerRouteHref({ name: 'discussion', discussionId: 'discussion-1' }).params;
    expect(params).toHaveProperty('intentId', undefined);
    expect(params).toHaveProperty('intentQuestion', undefined);
    expect(params).toHaveProperty('focusMessageId', undefined);
  });

  it('手机子页不重复首页，大屏保留双栏，专注阅读保持全屏', () => {
    expect(shouldShowReaderPrimaryPane({ name: 'library' }, false)).toBe(true);
    expect(shouldShowReaderPrimaryPane(routes[2]!, false)).toBe(false);
    expect(shouldShowReaderPrimaryPane(routes[2]!, true)).toBe(true);
    expect(shouldShowReaderPrimaryPane(routes[16]!, true)).toBe(false);
  });
});
