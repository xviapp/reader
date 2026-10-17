import type { ReaderBook, ReaderDiscussion, ReaderMessage, ReaderPassage } from '../domain/model';

type BookSource = Pick<ReaderBook, 'title' | 'authors'>;
type PassageSource = Pick<ReaderPassage, 'title' | 'pageLabel'>;

export interface ReaderTextShare {
  title: string;
  message: string;
}

function textShare(title: string, content: string, book: BookSource | null, passage: PassageSource | null = null): ReaderTextShare {
  if (!content.trim()) throw new Error('没有可分享的内容');
  const source = [
    book?.title.trim() ? `书名：${book.title.trim()}` : '',
    book?.authors.length ? `作者：${book.authors.join('、')}` : '',
    passage?.title.trim() ? `摘录：${passage.title.trim()}` : '',
    passage?.pageLabel.trim() ? `位置：${passage.pageLabel.trim()}` : '',
  ].filter(Boolean);
  return { title, message: [content.trim(), ...source.length ? ['', '——', ...source] : []].join('\n') };
}

export function readerPassageShare(book: BookSource, passage: Pick<ReaderPassage, 'title' | 'pageLabel' | 'sourceText' | 'rawSourceText' | 'summary' | 'analysisStatus'>, kind: 'source' | 'ocr' | 'summary'): ReaderTextShare {
  if (kind === 'summary' && passage.analysisStatus !== 'completed') throw new Error('分析完成后才能分享摘要');
  const content = kind === 'ocr' ? passage.rawSourceText : kind === 'summary' ? `AI 摘要\n\n${passage.summary}` : passage.sourceText;
  if (kind === 'summary' && !passage.summary.trim()) throw new Error('没有可分享的内容');
  return textShare(`${book.title} · ${kind === 'ocr' ? 'OCR 原文' : kind === 'summary' ? 'AI 摘要' : '摘录'}`, content, book, passage);
}

export function readerAnswerShare(message: Pick<ReaderMessage, 'content' | 'status' | 'role'>, discussion: Pick<ReaderDiscussion, 'title'> | null, book: BookSource | null): ReaderTextShare {
  if (message.role !== 'assistant' || message.status !== 'completed') throw new Error('回答完成后才能分享');
  if (!message.content.trim()) throw new Error('没有可分享的内容');
  // Do not attribute a historical answer to the discussion's current excerpt/revision.
  const share = textShare(discussion?.title || 'AI 回答', `AI 回答\n\n${message.content.trim()}`, book);
  return discussion?.title.trim() ? { ...share, message: `${share.message}\n讨论：${discussion.title.trim()}` } : share;
}

export function readerShareImageName(book: BookSource, passage: PassageSource, extension: string): string {
  const name = [book.title, passage.pageLabel, passage.title].filter((value) => value.trim()).join('-')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100);
  return `${name || 'reader-image'}.${extension}`;
}
