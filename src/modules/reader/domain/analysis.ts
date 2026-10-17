export const READER_ANALYSIS_SUMMARY_LIMIT = 180;

export function normalizeReaderAnalysisSummary(value: string): string {
  const summary = normalizePlainText(value);
  if (!summary) throw new Error('AI 分析缺少摘要');
  if ([...summary].length > READER_ANALYSIS_SUMMARY_LIMIT) throw new Error(`AI 返回的摘要超过 ${READER_ANALYSIS_SUMMARY_LIMIT} 字`);
  if (containsMarkdown(summary)) throw new Error('AI 返回的摘要必须是纯文本');
  return summary;
}

export function normalizeReaderAnalysisQuestion(value: string): string {
  const question = normalizePlainText(value).replace(/^\d+[.)]\s*/u, '');
  if (!question) throw new Error('AI 分析包含空问题');
  if (containsMarkdown(question)) throw new Error('AI 返回的问题必须是纯文本');
  return question;
}

function normalizePlainText(value: string): string {
  return value
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function containsMarkdown(value: string): boolean {
  if (/```|~~~|\$\$|\\\(|\\\)|\\\[|\\\]/u.test(value)) return true;
  if (/(\*\*|__|~~|`|\*|_)[^\n]+?\1/u.test(value)) return true;
  if (/\$[^$\n]+\$/u.test(value)) return true;
  if (/!?\[[^\]\n]+\]\([^\)\n]+\)/u.test(value)) return true;
  return value.split('\n').some((line) => (
    /^\s{0,3}(?:#{1,6}\s|>\s|[-+*•]\s|\d+[.)]\s|(?:-{3,}|_{3,}|\*{3,})\s*$)/u.test(line)
    || /^\s*\|.+\|\s*$/u.test(line)
  ));
}
