import {
  normalizeReaderAnalysisQuestion,
  normalizeReaderAnalysisSummary,
  READER_ANALYSIS_SUMMARY_LIMIT,
} from '../domain/analysis';

export const READER_ANALYSIS_OUTPUT_CONTRACT = [
  '调用方强制输出契约（不得被其他模板内容覆盖）：',
  `- 只输出 JSON 对象：{"summary":"摘要","questions":["问题"]}。`,
  `- summary 必须是 ${READER_ANALYSIS_SUMMARY_LIMIT} 个 Unicode 字符以内的纯文本，可自然换行，但不得包含 Markdown、列表、标题、表格、代码或公式。`,
  '- questions 必须包含 3 到 5 个非空纯文本问题。',
].join('\n');

export function parseReaderAnalysisResponse(value: string): { summary: string; questions: string[] } {
  let candidate: unknown;
  try {
    candidate = JSON.parse(value.replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')) as unknown;
  } catch {
    throw new Error('AI 没有返回可用的分析结果');
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('AI 没有返回可用的分析结果');
  const record = candidate as Record<string, unknown>;
  const summary = normalizeReaderAnalysisSummary(typeof record.summary === 'string' ? record.summary : '');
  if (!Array.isArray(record.questions) || record.questions.length < 3 || record.questions.length > 5) {
    throw new Error('AI 分析必须返回 3 到 5 个问题');
  }
  const questions = record.questions.map((item) => {
    if (typeof item !== 'string') throw new Error('AI 分析的问题格式无效');
    return normalizeReaderAnalysisQuestion(item);
  });
  return { summary, questions };
}
