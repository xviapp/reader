import type {
  ReaderBookDraft,
  ReaderBookStatus,
  ReaderDiscussion,
  ReaderDiscussionDraft,
  ReaderFolder,
  ReaderOcrBlock,
  ReaderPassage,
  ReaderPassageDraft,
  ReaderPreferences,
  ReaderPromptDraft,
  ReaderReadingSession,
  ReaderReadingSessionDraft,
  ReaderReadingSummary,
  ReaderRoleDraft,
} from './model';

const statuses = new Set<ReaderBookStatus>(['unread', 'reading', 'finished']);

function bounded(value: string, limit: number): string {
  return value.replace(/\r\n/g, '\n').trim().slice(0, limit);
}

export function normalizeReaderBook(input: ReaderBookDraft): ReaderBookDraft {
  const title = bounded(input.title, 240);
  if (!title) throw new Error('书名不能为空');
  const authors = [...new Set(input.authors.map((author) => bounded(author, 160)).filter(Boolean))].slice(0, 20);
  return {
    title,
    authors,
    coverUri: bounded(input.coverUri, 2_000),
    isbn: bounded(input.isbn, 64),
    publisher: bounded(input.publisher, 160),
    publishedAt: bounded(input.publishedAt, 32),
    summary: bounded(input.summary, 20_000),
    note: bounded(input.note, 100_000),
    status: statuses.has(input.status) ? input.status : 'unread',
    ...pagesOf(input.pageCount, input.pagesRead),
    roleId: bounded(input.roleId, 80) || 'reader-role-general',
    customPrompt: bounded(input.customPrompt, 50_000),
  };
}

const MAX_PAGES = 100_000;
const wholePages = (value: unknown) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(MAX_PAGES, number)) : 0;
};

/** Progress is never entered: it follows the pages read out of the book's page count. */
function pagesOf(pageCountInput: unknown, pagesReadInput: unknown): Pick<ReaderBookDraft, 'pageCount' | 'pagesRead' | 'progress'> {
  const pageCount = wholePages(pageCountInput);
  const pagesRead = pageCount ? Math.min(pageCount, wholePages(pagesReadInput)) : wholePages(pagesReadInput);
  return { pageCount, pagesRead, progress: pageCount && pagesRead ? Math.max(1, Math.min(100, Math.round(pagesRead / pageCount * 100))) : 0 };
}

/** The reading progress to show, or null while the page count or pages read is unknown. */
export function readerBookProgress(book: Pick<ReaderBookDraft, 'pageCount' | 'pagesRead'>): number | null {
  const { pageCount, pagesRead, progress } = pagesOf(book.pageCount, book.pagesRead);
  return pageCount && pagesRead ? progress : null;
}

export type ReaderProgressEntry =
  | { ok: true; pageCount: number; pagesRead: number; page: number | null }
  | { ok: false; error: string };

/** Reads the progress sheet: a blank page keeps the pages already read; the page count is only entered while unknown. */
export function readerProgressEntry(book: Pick<ReaderBookDraft, 'pageCount' | 'pagesRead'>, pageText: string, pageCountText = ''): ReaderProgressEntry {
  let pageCount = book.pageCount;
  if (!pageCount && pageCountText.trim()) {
    pageCount = Number(pageCountText.trim());
    if (!Number.isInteger(pageCount) || pageCount <= 0) return { ok: false, error: '全书页数请填写正整数，或留空。' };
  }
  const page = pageText.trim() ? Number(pageText.trim()) : null;
  if (page !== null && (!Number.isInteger(page) || page < 0)) return { ok: false, error: '页码请填写整数，或留空。' };
  if (page !== null && pageCount && page > pageCount) return { ok: false, error: `超过全书页数（${pageCount}）` };
  return { ok: true, pageCount, pagesRead: page ?? book.pagesRead, page };
}

/** The status a page entry suggests: the last page finishes the book, any page starts it, and fewer pages reopen a finished one. */
export function readerStatusForPages(base: ReaderBookStatus, pagesRead: number, pageCount: number): ReaderBookStatus {
  if (pageCount && pagesRead >= pageCount) return 'finished';
  if (pagesRead > 0 && base === 'unread') return 'reading';
  if (pageCount && pagesRead > 0 && base === 'finished') return 'reading';
  return base;
}

/** A timer running longer than this was probably left on; ending it asks for the real reading time. */
export const READER_LONG_SESSION_MS = 3 * 3_600_000;

/** The minutes entered for a timer that ran too long: a whole number from 1 up to the time it ran. */
export function readerSessionMinutesEntry(text: string, elapsedMs: number): { ok: true; minutes: number } | { ok: false; error: string } {
  const max = Math.max(1, Math.floor(elapsedMs / 60_000));
  const minutes = Number(text.trim());
  if (!text.trim() || !Number.isInteger(minutes) || minutes < 1 || minutes > max) return { ok: false, error: `阅读时长请填写 1 到 ${max} 之间的分钟数。` };
  return { ok: true, minutes };
}

/** A corrected session: the start stays, the minutes set the end, and pages are optional whole numbers within the book. */
export function readerSessionEditEntry(
  session: Pick<ReaderReadingSession, 'startedAt'>,
  input: { minutes: string; startPage: string; endPage: string },
  pageCount: number,
): { ok: true; draft: ReaderReadingSessionDraft } | { ok: false; error: string } {
  const minutes = sessionMinutesOf(input.minutes);
  if (minutes === null) return { ok: false, error: '阅读时长请填写 1 到 1440 之间的分钟数。' };
  const pages = sessionPagesOf(input, pageCount);
  if (!pages.ok) return pages;
  const endedAt = new Date(Date.parse(session.startedAt) + minutes * 60_000).toISOString();
  return { ok: true, draft: { startedAt: session.startedAt, endedAt, startPage: pages.startPage, endPage: pages.endPage } };
}

/** A session read without the timer: a recent day, its start time and minutes, which must end by now. */
export function readerManualSessionEntry(
  input: { daysAgo: number; time: string; minutes: string; startPage: string; endPage: string },
  pageCount: number,
  now = new Date(),
): { ok: true; draft: ReaderReadingSessionDraft } | { ok: false; error: string } {
  const time = clockOf(input.time);
  if (!time) return { ok: false, error: '开始时间请按 21:00 的格式填写。' };
  const { hours, minutes: clockMinutes } = time;
  const minutes = sessionMinutesOf(input.minutes);
  if (minutes === null) return { ok: false, error: '阅读时长请填写 1 到 1440 之间的分钟数。' };
  const pages = sessionPagesOf(input, pageCount);
  if (!pages.ok) return pages;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - input.daysAgo, hours, clockMinutes);
  const end = new Date(start.getTime() + minutes * 60_000);
  if (end.getTime() > now.getTime()) return { ok: false, error: '结束时间不能晚于现在。' };
  return { ok: true, draft: { startedAt: start.toISOString(), endedAt: end.toISOString(), startPage: pages.startPage, endPage: pages.endPage } };
}

/** 21:00, 21：00, 21.00 and 2100 all read as 21:00; number pads often lack a colon. */
function clockOf(text: string): { hours: number; minutes: number } | null {
  const time = /^(\d{1,2})[:：.]?(\d{2})$/u.exec(text.trim());
  if (!time) return null;
  const hours = Number(time[1]);
  const minutes = Number(time[2]);
  return hours <= 23 && minutes <= 59 ? { hours, minutes } : null;
}

/** The minutes from a timer's start to the first time the clock shows `text` after it, which must not be later than now. */
export function readerMinutesUntilClock(startedAt: string, text: string, now = new Date()): { ok: true; minutes: number } | { ok: false; error: string } {
  const time = clockOf(text);
  if (!time) return { ok: false, error: '结束时间请按 07:20 的格式填写。' };
  const start = new Date(startedAt);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), time.hours, time.minutes);
  while (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  if (end.getTime() > now.getTime()) return { ok: false, error: '结束时间要在开始之后、现在之前。' };
  return { ok: true, minutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)) };
}

/** The clock time a number of minutes after a start, as HH:MM. */
export function readerClockAfter(startedAt: string, minutes: number): string {
  const end = new Date(Date.parse(startedAt) + minutes * 60_000);
  return `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
}

function sessionMinutesOf(text: string): number | null {
  const minutes = Number(text.trim());
  return text.trim() && Number.isInteger(minutes) && minutes >= 1 && minutes <= 24 * 60 ? minutes : null;
}

function sessionPagesOf(input: { startPage: string; endPage: string }, pageCount: number): { ok: true; startPage: number | null; endPage: number | null } | { ok: false; error: string } {
  const pages: (number | null)[] = [];
  for (const text of [input.startPage, input.endPage]) {
    const page = text.trim() ? Number(text.trim()) : null;
    if (page !== null && (!Number.isInteger(page) || page < 0)) return { ok: false, error: '页码请填写整数，或留空。' };
    if (page !== null && pageCount && page > pageCount) return { ok: false, error: `超过全书页数（${pageCount}）` };
    pages.push(page);
  }
  return { ok: true, startPage: pages[0] ?? null, endPage: pages[1] ?? null };
}

/** Pages per hour over sessions that recorded both pages and moved forward; null below ten minutes of such reading. */
export function readerReadingSpeed(sessions: readonly ReaderReadingSession[]): number | null {
  let pages = 0;
  let ms = 0;
  for (const session of sessions) {
    if (session.startPage === null || session.endPage === null || session.endPage <= session.startPage) continue;
    pages += session.endPage - session.startPage;
    ms += session.durationMs;
  }
  return ms >= 10 * 60_000 ? Math.round(pages / (ms / 3_600_000)) : null;
}

/** Time left at the given pace, or null while the pages left or the pace are unknown. */
export function readerRemainingMs(book: Pick<ReaderBookDraft, 'pageCount' | 'pagesRead'>, pagesPerHour: number | null): number | null {
  if (!pagesPerHour || !book.pageCount || book.pagesRead >= book.pageCount) return null;
  return Math.round((book.pageCount - book.pagesRead) / pagesPerHour * 3_600_000);
}

/** Reading time per local day for the last `days` days, oldest first, ending today. */
export function readerDailyReading(sessions: readonly ReaderReadingSession[], now = new Date(), days = 30): readonly { key: string; ms: number }[] {
  const totals = new Map<string, number>();
  for (const session of sessions) {
    const key = localDayKey(new Date(session.startedAt));
    totals.set(key, (totals.get(key) ?? 0) + session.durationMs);
  }
  return Array.from({ length: days }, (_, index) => {
    const key = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1 - index)));
    return { key, ms: totals.get(key) ?? 0 };
  });
}

/** Reading time as 分钟 below an hour, else 小时 with the remaining minutes. */
export function readerReadingDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} 小时${rest ? ` ${rest} 分` : ''}`;
}

/** The book's kept sessions in one line, or null before the first one. */
export function readerReadingSummaryLabel(summary: ReaderReadingSummary, now = new Date()): string | null {
  if (!summary.sessionCount) return null;
  const parts = [`累计 ${readerReadingDuration(summary.totalMs)}`, `${summary.sessionCount} 次`];
  const last = summary.lastReadAt ? new Date(summary.lastReadAt) : null;
  if (last && !Number.isNaN(last.getTime())) parts.push(`最近 ${readerDayLabel(last, now)}`);
  return parts.join(' · ');
}

export interface ReaderReadingDay {
  /** Local calendar day, YYYY-MM-DD. */
  key: string;
  label: string;
  totalMs: number;
  sessions: readonly ReaderReadingSession[];
}

export interface ReaderReadingStats {
  totalMs: number;
  sessionCount: number;
  averageMs: number;
  /** Pages gained across sessions that recorded both ends; null when none did. */
  pagesRead: number | null;
  firstReadAt: string | null;
  lastReadAt: string | null;
}

/** Sessions grouped by the local day they started, newest day and session first. */
export function readerReadingDays(sessions: readonly ReaderReadingSession[], now = new Date()): readonly ReaderReadingDay[] {
  const days = new Map<string, ReaderReadingSession[]>();
  const sorted = [...sessions].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  for (const session of sorted) {
    const key = localDayKey(new Date(session.startedAt));
    days.set(key, [...days.get(key) ?? [], session]);
  }
  return [...days].map(([key, items]) => ({
    key,
    label: readerDayLabel(new Date(items[0]!.startedAt), now),
    totalMs: items.reduce((sum, item) => sum + item.durationMs, 0),
    sessions: items,
  }));
}

export function readerReadingStats(sessions: readonly ReaderReadingSession[]): ReaderReadingStats {
  const totalMs = sessions.reduce((sum, item) => sum + item.durationMs, 0);
  const paged = sessions.filter((item) => item.startPage !== null && item.endPage !== null);
  const starts = sessions.map((item) => item.startedAt).sort();
  const ends = sessions.map((item) => item.endedAt).sort();
  return {
    totalMs,
    sessionCount: sessions.length,
    averageMs: sessions.length ? Math.round(totalMs / sessions.length) : 0,
    pagesRead: paged.length ? paged.reduce((sum, item) => sum + Math.max(0, item.endPage! - item.startPage!), 0) : null,
    firstReadAt: starts[0] ?? null,
    lastReadAt: ends.at(-1) ?? null,
  };
}

/** 今天 / 昨天, else the date, with the year only when it is not the current one. */
export function readerDayLabel(day: Date, now = new Date()): string {
  const key = localDayKey(day);
  if (key === localDayKey(now)) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === localDayKey(yesterday)) return '昨天';
  const date = `${day.getMonth() + 1}月${day.getDate()}日`;
  return day.getFullYear() === now.getFullYear() ? date : `${day.getFullYear()}年${date}`;
}

/** The pages a session moved through, or null when it did not record them. */
export function readerSessionPagesLabel(session: Pick<ReaderReadingSession, 'startPage' | 'endPage'>): string | null {
  if (session.endPage === null) return null;
  if (session.startPage === null || session.startPage === session.endPage) return `读到第 ${session.endPage} 页`;
  const gained = session.endPage - session.startPage;
  return gained > 0 ? `第 ${session.startPage} → ${session.endPage} 页 · ${gained} 页` : `第 ${session.startPage} → ${session.endPage} 页`;
}

function localDayKey(day: Date): string {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

export function normalizeReaderPassage(input: ReaderPassageDraft): ReaderPassageDraft {
  const sourceText = bounded(input.sourceText, 500_000);
  const rawSourceText = bounded(input.rawSourceText || sourceText, 500_000);
  const imageUri = bounded(input.imageUri, 2_000);
  if (!sourceText && !rawSourceText && !imageUri) throw new Error('请添加原文或书页图片');
  return {
    title: bounded(input.title, 240),
    pageLabel: bounded(input.pageLabel, 120),
    imageUri,
    rawSourceText,
    sourceText,
    ocrScript: input.ocrScript === 'chinese' || input.ocrScript === 'latin' ? input.ocrScript : 'auto',
    ocrBlocks: input.ocrBlocks.slice(0, 2_000).map(normalizeOcrBlock),
  };
}

export function normalizeReaderDiscussion(input: ReaderDiscussionDraft): ReaderDiscussionDraft {
  const openingMessage = bounded(input.openingMessage, 100_000);
  if (!openingMessage) throw new Error('请输入想讨论的问题');
  const rawPassageIds = [...new Set(
    (input.passageIds?.length ? input.passageIds : input.passageId ? [input.passageId] : [])
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  if (rawPassageIds.length > 5) throw new Error('一次最多关联 5 条摘录');
  const passageIds = rawPassageIds;
  return {
    title: bounded(input.title, 240) || openingMessage.replace(/\s+/gu, ' ').slice(0, 48),
    bookId: input.bookId || null,
    passageId: passageIds[0] ?? null,
    passageIds,
    folderId: input.folderId || null,
    openingMessage,
  };
}

/** Returns the canonical discussion source order while accepting legacy snapshots. */
export function readerDiscussionPassageIds(
  input: Pick<ReaderDiscussion, 'sources' | 'passageIds' | 'passageId'>,
): readonly string[] {
  if (input.sources?.length) return input.sources.map((source) => source.passageId);
  return input.passageIds?.length
    ? input.passageIds
    : input.passageId ? [input.passageId] : [];
}

export function readerDiscussionContextError(
  input: Pick<ReaderDiscussionDraft, 'bookId' | 'passageId' | 'passageIds'>,
  passages: ReadonlyMap<string, Pick<ReaderPassage, 'id' | 'bookId' | 'deletedAt'>>,
): string | null {
  const sourceIds = input.passageIds?.length
    ? input.passageIds
    : input.passageId ? [input.passageId] : [];
  if (!sourceIds.length) return null;
  for (const id of sourceIds) {
    const passage = passages.get(id);
    if (!passage || passage.deletedAt !== null) return '关联的摘录不存在或已在回收站';
    if (input.bookId !== passage.bookId) return '关联书籍与摘录所属书籍不一致';
  }
  return null;
}

export function assertReaderDiscussionContext(
  input: Pick<ReaderDiscussionDraft, 'bookId' | 'passageId' | 'passageIds'>,
  passages: ReadonlyMap<string, Pick<ReaderPassage, 'id' | 'bookId' | 'deletedAt'>>,
): void {
  const error = readerDiscussionContextError(input, passages);
  if (error) throw new Error(error);
}

export function normalizeReaderFolderName(value: string): string {
  const name = bounded(value, 80);
  if (!name) throw new Error('文件夹名称不能为空');
  return name;
}

export function normalizeReaderPrompt(input: ReaderPromptDraft): ReaderPromptDraft {
  const systemTemplate = bounded(input.systemTemplate, 100_000);
  const userTemplate = bounded(input.userTemplate, 100_000);
  if (!systemTemplate || !userTemplate) throw new Error('System 和 User 模板不能为空');
  const invalid = [...templateVariables(systemTemplate), ...templateVariables(userTemplate)]
    .filter((value) => !READER_PROMPT_VARIABLES.includes(value as ReaderPromptVariable));
  if (invalid.length > 0 || hasInvalidTemplateSyntax(systemTemplate) || hasInvalidTemplateSyntax(userTemplate)) {
    throw new Error(invalid.length > 0 ? `未知 Prompt 变量：${[...new Set(invalid)].join('、')}` : 'Prompt 模板语法无效');
  }
  return {
    systemTemplate,
    userTemplate,
    includeBook: input.includeBook,
    includeSource: input.includeSource,
    includeSummary: input.includeSummary,
    historyLimit: Math.max(0, Math.min(50, Math.round(input.historyLimit))),
  };
}

export function normalizeReaderRole(input: ReaderRoleDraft): ReaderRoleDraft {
  const name = bounded(input.name, 80);
  const prompt = bounded(input.prompt, 100_000);
  if (!name || !prompt) throw new Error('角色名称和 Prompt 不能为空');
  return { name, description: bounded(input.description, 240), prompt };
}

export function normalizeReaderPreferences(input: ReaderPreferences): ReaderPreferences {
  return {
    ...input,
    ocrScript: input.ocrScript === 'chinese' || input.ocrScript === 'latin' ? input.ocrScript : 'auto',
  };
}

export function readerStatusLabel(status: ReaderBookStatus): string {
  if (status === 'reading') return '阅读中';
  if (status === 'finished') return '已读完';
  return '未开始';
}

export function readerPrimaryAuthor(authors: readonly string[]): string {
  return authors.join(' / ') || '未知作者';
}

export function passageDisplayTitle(title: string, pageLabel: string, sourceText: string): string {
  if (title.trim()) return title.trim();
  if (pageLabel.trim()) return passageLocationLabel(pageLabel);
  return sourceText.replace(/\s+/gu, ' ').trim().slice(0, 36) || '未命名摘录';
}

export function passageLocationLabel(pageLabel: string): string {
  const value = pageLabel.trim();
  if (!value) return '';
  return /^\d+$/u.test(value) ? `第 ${value} 页` : value;
}

function normalizeOcrBlock(block: ReaderOcrBlock): ReaderOcrBlock {
  return {
    text: bounded(block.text, 20_000),
    confidence: block.confidence === null ? null : Math.max(0, Math.min(1, block.confidence)),
    box: {
      x: Math.max(0, Math.min(1, block.box.x)),
      y: Math.max(0, Math.min(1, block.box.y)),
      width: Math.max(0, Math.min(1, block.box.width)),
      height: Math.max(0, Math.min(1, block.box.height)),
    },
  };
}

export const READER_PROMPT_VARIABLES = [
  'book_title',
  'book_authors',
  'book_publisher',
  'passage_text',
  'raw_source_text',
  'passage_summary',
  'question',
  'role_prompt',
] as const;

export type ReaderPromptVariable = (typeof READER_PROMPT_VARIABLES)[number];

export function templateVariables(template: string): string[] {
  const variables: string[] = [];
  const pattern = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/gu;
  for (const match of template.matchAll(pattern)) if (match[1]) variables.push(match[1]);
  return variables;
}

function hasInvalidTemplateSyntax(template: string): boolean {
  return template.replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/gu, '').includes('{{')
    || template.replace(/\{\{\s*[A-Za-z0-9_]+\s*\}\}/gu, '').includes('}}');
}

export function activeFolders(folders: readonly ReaderFolder[]): ReaderFolder[] {
  return folders.filter((folder) => folder.deletedAt === null).sort((a, b) => a.position - b.position);
}
