import type {
  ReaderBook,
  ReaderMessage,
  ReaderPassage,
  ReaderPrompt,
  ReaderRole,
} from '../domain/model';
import { normalizeReaderPrompt, type ReaderPromptVariable } from '../domain/rules';
import { READER_ANALYSIS_OUTPUT_CONTRACT } from './reader-analysis-result';

export interface ReaderPromptContext {
  book: ReaderBook | null;
  passage: ReaderPassage | null;
  passages?: readonly ReaderPassage[];
  role: ReaderRole | null;
  question: string;
  messages: readonly ReaderMessage[];
}

export interface RenderedReaderPrompt {
  system: string;
  user: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

export function renderReaderPrompt(prompt: ReaderPrompt, context: ReaderPromptContext): RenderedReaderPrompt {
  normalizeReaderPrompt(prompt);
  const passages = context.passages?.length
    ? context.passages
    : context.passage ? [context.passage] : [];
  const passageText = passages.length <= 1
    ? passages[0]?.sourceText ?? ''
    : passages.map((passage, index) => `摘录 ${index + 1}${passage.pageLabel ? `（${passage.pageLabel}）` : ''}\n${passage.sourceText}`).join('\n\n---\n\n');
  const rawSourceText = passages.length <= 1
    ? passages[0]?.rawSourceText ?? passages[0]?.sourceText ?? ''
    : passages.map((passage, index) => `摘录 ${index + 1}${passage.pageLabel ? `（${passage.pageLabel}）` : ''}\n${passage.rawSourceText || passage.sourceText}`).join('\n\n---\n\n');
  const passageSummary = passages.map((passage, index) => {
    const value = passage.summary.trim();
    return value ? (passages.length > 1 ? `摘录 ${index + 1}：${value}` : value) : '';
  }).filter(Boolean).join('\n\n');
  const values: Record<ReaderPromptVariable, string> = {
    book_title: prompt.includeBook ? context.book?.title ?? '' : '',
    book_authors: prompt.includeBook ? context.book?.authors.join(' / ') ?? '' : '',
    book_publisher: prompt.includeBook ? context.book?.publisher ?? '' : '',
    passage_text: prompt.includeSource ? passageText : '',
    raw_source_text: prompt.includeSource ? rawSourceText : '',
    passage_summary: prompt.includeSummary ? passageSummary : '',
    question: context.question.trim(),
    role_prompt: context.book?.customPrompt.trim() || context.role?.prompt.trim() || '',
  };
  const history = context.messages
    .filter((message) => message.deletedAt === null && message.status === 'completed')
    .slice(-prompt.historyLimit)
    .map((message) => ({ role: message.role, content: message.content }));
  const system = interpolate(prompt.systemTemplate, values).trim();
  return {
    system: prompt.stage === 'analysis' ? `${system}\n\n${READER_ANALYSIS_OUTPUT_CONTRACT}` : system,
    user: interpolate(prompt.userTemplate, values).trim(),
    history,
  };
}

export function previewReaderPrompt(prompt: ReaderPrompt, context: ReaderPromptContext): string {
  const rendered = renderReaderPrompt(prompt, context);
  const history = rendered.history.length
    ? rendered.history.map((message) => `${message.role === 'user' ? '读者' : '助手'}：${message.content}`).join('\n\n')
    : '无';
  return `System\n${rendered.system}\n\nHistory\n${history}\n\nUser\n${rendered.user}`;
}

function interpolate(template: string, values: Readonly<Record<ReaderPromptVariable, string>>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/gu, (_, variable: string) => (
    values[variable as ReaderPromptVariable] ?? ''
  ));
}
