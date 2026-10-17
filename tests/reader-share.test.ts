import { describe, expect, it } from 'vitest';

import { readerAnswerShare, readerPassageShare, readerShareImageName } from '@/modules/reader/application/reader-share';

const book = { title: '阅读之书', authors: ['作者甲', '作者乙'] };
const passage = { title: '第一节', pageLabel: '第 12 页', sourceText: '整理后的文字', rawSourceText: '原始 OCR 文字', summary: '摘要', analysisStatus: 'completed' as const };

describe('Reader sharing payloads', () => {
  it('shares the saved excerpt with book, authors and page provenance', () => {
    expect(readerPassageShare(book, passage, 'source').message).toBe('整理后的文字\n\n——\n书名：阅读之书\n作者：作者甲、作者乙\n摘录：第一节\n位置：第 12 页');
  });
  it('keeps raw OCR separate from edited source and labels AI summaries', () => {
    expect(readerPassageShare(book, passage, 'ocr').message).toContain('原始 OCR 文字');
    expect(readerPassageShare(book, passage, 'ocr').message).not.toContain('整理后的文字');
    expect(readerPassageShare(book, passage, 'summary').message).toContain('AI 摘要\n\n摘要');
  });
  it('rejects blank text and unfinished summaries', () => {
    expect(() => readerPassageShare(book, { ...passage, sourceText: ' ' }, 'source')).toThrow('没有');
    expect(() => readerPassageShare(book, { ...passage, analysisStatus: 'running' }, 'summary')).toThrow('完成');
  });
  it('preserves full answer Markdown and discussion attribution without adding current source text', () => {
    const share = readerAnswerShare({ role: 'assistant', status: 'completed', content: '# 回答\n\n**完整内容**' }, { title: '讨论一' }, book);
    expect(share.message).toContain('# 回答\n\n**完整内容**');
    expect(share.message).toContain('讨论：讨论一');
    expect(share.message).toContain('书名：阅读之书');
    expect(share.message).not.toContain('file://');
    expect(share.message).not.toContain('位置：');
  });
  it('allows independent discussions and rejects streaming/user/empty answers', () => {
    expect(readerAnswerShare({ role: 'assistant', status: 'completed', content: '答案' }, null, null).message).toBe('AI 回答\n\n答案');
    expect(() => readerAnswerShare({ role: 'assistant', status: 'pending', content: '部分' }, null, null)).toThrow('完成');
    expect(() => readerAnswerShare({ role: 'user', status: 'completed', content: '问题' }, null, null)).toThrow('完成');
    expect(() => readerAnswerShare({ role: 'assistant', status: 'completed', content: ' ' }, null, null)).toThrow('没有');
  });
  it('puts book/page in a safe image filename', () => {
    expect(readerShareImageName(book, passage, 'jpg')).toBe('阅读之书-第 12 页-第一节.jpg');
    expect(readerShareImageName({ title: '../a:b', authors: [] }, { title: '', pageLabel: '' }, 'png')).toBe('.._a_b.png');
  });
});
