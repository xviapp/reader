import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { strToU8, zipSync } from 'fflate';

import type { ReaderBook, ReaderDiscussion, ReaderMessage, ReaderPassage, ReaderReadingSummary } from '../domain/model';
import { readerBookProgress, readerDiscussionPassageIds, readerReadingSummaryLabel } from '../domain/rules';

export interface ReaderBookExportDiscussion {
  discussion: ReaderDiscussion;
  messages: readonly ReaderMessage[];
}

export interface ReaderBookExportInput {
  book: ReaderBook;
  passages: readonly ReaderPassage[];
  discussions: readonly ReaderBookExportDiscussion[];
  reading?: ReaderReadingSummary | null;
}

/** Creates a self-contained Markdown package without exposing OCR text by default. */
export async function exportReaderBook(input: ReaderBookExportInput, includeSource = false): Promise<string> {
  const imagePaths = new Map<string, string>();
  const files: Record<string, Uint8Array> = {};
  for (const passage of input.passages) {
    if (!passage.imageUri) continue;
    try {
      const source = new File(passage.imageUri);
      const extension = imageExtension(source.name);
      const path = `images/passage-${safeName(passage.id)}.${extension}`;
      files[path] = await source.bytes();
      imagePaths.set(passage.id, path);
    } catch {
      // A stale or provider-owned URI should not prevent the rest of the book from exporting.
    }
  }

  const markdown = renderReaderBookMarkdown(input, imagePaths, includeSource);
  files['README.md'] = strToU8(markdown);
  files['manifest.json'] = strToU8(JSON.stringify({
    format: 'reader-book-export-v1',
    createdAt: new Date().toISOString(),
    bookId: input.book.id,
    passageCount: input.passages.length,
    discussionCount: input.discussions.length,
    imageCount: imagePaths.size,
  }, null, 2));

  const filename = `${safeName(input.book.title) || 'reader-book'}-资料.zip`;
  const archive = new File(Paths.cache, filename);
  if (archive.exists) archive.delete();
  archive.write(zipSync(files, { level: 6 }));
  if (!await isAvailableAsync()) throw new Error('系统分享不可用，请稍后重试');
  await shareAsync(archive.uri, { dialogTitle: '导出数据', mimeType: 'application/zip' });
  return archive.uri;
}

export function renderReaderBookMarkdown(input: ReaderBookExportInput, imagePaths: ReadonlyMap<string, string> = new Map(), includeSource = false): string {
  const { book } = input;
  const lines: string[] = [
    `# ${headingText(book.title)}`,
    '',
    `- 作者：${book.authors.join('、') || '未填写'}`,
    `- 阅读状态：${[statusLabel(book.status), readerBookProgress(book) !== null ? `${readerBookProgress(book)}%` : ''].filter(Boolean).join(' · ')}`,
  ];
  const reading = input.reading ? readerReadingSummaryLabel(input.reading) : null;
  if (reading) lines.push(`- 阅读记录：${reading}`);
  if (book.publisher || book.publishedAt) lines.push(`- 出版信息：${[book.publisher, book.publishedAt].filter(Boolean).join(' · ')}`);
  if (book.isbn) lines.push(`- ISBN：${book.isbn}`);
  if (book.summary.trim()) lines.push('', '## 简介', '', book.summary.trim());
  if (book.note.trim()) lines.push('', '## 读书备注', '', book.note.trim());
  lines.push('', '## 摘录');
  if (!input.passages.length) lines.push('', '暂无摘录。');
  for (const passage of input.passages) {
    lines.push('', `### ${headingText(passage.title || passage.pageLabel || '未命名摘录')}`);
    if (passage.pageLabel.trim()) lines.push(`位置：${passage.pageLabel.trim()}`);
    const imagePath = imagePaths.get(passage.id);
    if (imagePath) lines.push('', `![摘录图片](<${imagePath}>)`);
    else if (passage.imageUri) lines.push('', '（摘录图片未能打包）');
    if (passage.summary.trim()) lines.push('', '**AI 摘要**', '', passage.summary.trim());
    if (!passage.summary.trim()) lines.push('', '暂无 AI 摘要。');
    if (includeSource && passage.sourceText.trim()) lines.push('', '**识别文字**', '', passage.sourceText.trim());
  }
  lines.push('', '## 讨论与回答');
  if (!input.discussions.length) lines.push('', '暂无讨论。');
  for (const item of input.discussions) {
    lines.push('', `### ${headingText(item.discussion.title || '未命名讨论')}`);
    const sourceIds = readerDiscussionPassageIds(item.discussion);
    if (sourceIds.length) {
      const sourceLabels = sourceIds.map((id) => {
        const source = input.passages.find((passage) => passage.id === id);
        return source ? `${source.title || source.pageLabel || '未命名摘录'}${source.pageLabel ? ` · ${source.pageLabel}` : ''}` : '已移除摘录';
      });
      lines.push('', `关联摘录：${sourceLabels.join('；')}`);
    }
    if (!item.messages.length) {
      lines.push('', '暂无消息。');
      continue;
    }
    for (const message of item.messages) {
      const label = message.role === 'user' ? '问题' : message.favorite ? 'AI 回答 · 已收藏' : 'AI 回答';
      lines.push('', `**${label}**`, '', message.content.trim() || '（空消息）');
    }
  }
  lines.push('', '---', '', `由「阅读」导出。${includeSource ? 'OCR 识别文字随完整数据一并导出。' : '当前导出未包含 OCR 识别文字。'}`);
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trim()}\n`;
}

function headingText(value: string): string {
  return value.replace(/[\r\n]+/gu, ' ').replace(/^#+/u, '').trim() || '未命名';
}

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\r\n]+/gu, '-').replace(/\s+/gu, ' ').trim().slice(0, 80);
}

function imageExtension(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension && /^[a-z0-9]{1,5}$/u.test(extension) ? extension : 'jpg';
}

function statusLabel(value: ReaderBook['status']): string {
  if (value === 'reading') return '阅读中';
  if (value === 'finished') return '已读完';
  return '未开始';
}
