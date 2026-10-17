import type { AiEngine } from '@/core/ai/ai-engine';

export interface ReaderBookPromptInput {
  title: string;
  authors: readonly string[];
  publisher: string;
  publishedAt: string;
  summary: string;
  note: string;
  roleName: string;
  roleDescription: string;
}

const BOOK_PROMPT_MAX_LENGTH = 1_000;

const GENERATE_BOOK_PROMPT_SYSTEM = [
  '你是一位资深的阅读引导专家，专门为一本具体的书写一段"本书专属阅读指引"。这段指引会被原样插入 AI 阅读伙伴 Prompt 的"阅读角色"位置，用来调整它讨论这本书时的人设与侧重点。',
  '',
  '请只输出一段中文指引，并严格遵守：',
  '1. 直接给出指引本身——不要标题、标签、引号、分隔符、Markdown 或代码块。',
  '2. 用"你（阅读伙伴）"的口吻写成对这位伙伴的补充指令，而不是对书的客观描述；内容要能自然接在"你是一位……"之后。',
  '3. 根据书的题材确定阅读角度：小说/文学作品侧重人物、叙事、主题、风格与时代背景；非虚构/学术侧重核心论点、论证结构、证据与上下文。',
  '4. 指出这本书值得重点关注的 2–3 个方面，并说明回应应持有的分寸（如克制、理性、先证据后观点、鼓励批判性追问）。',
  '5. 只使用输入中给出的信息，不要编造作者、年代、事件或书评；信息不足时保持通用但仍贴近已知事实。',
  '6. 整段不要出现 {{ }} 这类模板变量，也不要出现"我是一个 AI"之类的表述。',
  '7. 控制在 80–160 个汉字左右。',
].join('\n');

export class ReaderBookAi {
  constructor(private readonly getAi: () => AiEngine | null) {}

  async generateBookCustomPrompt(input: ReaderBookPromptInput, signal?: AbortSignal): Promise<string> {
    const ai = this.requireAi();
    const result = await ai.generate({
      messages: [
        { role: 'system', content: GENERATE_BOOK_PROMPT_SYSTEM },
        { role: 'user', content: assembleBookPromptContext(input) },
      ],
      temperature: 0.6,
    }, signal ? { signal } : undefined);
    return cleanBookPrompt(result.text);
  }

  private requireAi(): AiEngine {
    const ai = this.getAi();
    if (!ai) throw new Error('AI 未配置');
    return ai;
  }

}

function assembleBookPromptContext(input: ReaderBookPromptInput): string {
  return [
    '书籍信息：',
    `- 书名：${input.title.trim() || '未知'}`,
    `- 作者：${input.authors.join(' / ') || '未知'}`,
    `- 出版社：${input.publisher.trim() || '未知'}`,
    `- 出版日期：${input.publishedAt.trim() || '未知'}`,
    `- 简介：${input.summary.trim() || '无'}`,
    `- 读书备注：${input.note.trim() || '无'}`,
    `- 已选阅读角色：${input.roleName.trim() || '通用阅读伙伴'}`,
    `- 角色说明：${input.roleDescription.trim() || '无'}`,
  ].join('\n');
}

function cleanBookPrompt(value: string): string {
  return value
    .replace(/^```(?:text|plaintext)?[^\n]*\n?/u, '')
    .replace(/\n?```$/u, '')
    .trim()
    .slice(0, BOOK_PROMPT_MAX_LENGTH);
}
