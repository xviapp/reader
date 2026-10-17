import { describe, expect, it, vi } from 'vitest';

import { AiEngineError, type AiEngine } from '@/core/ai/ai-engine';
import type { AiTask, AiTaskHandler, AiTaskRunner } from '@/core/ai/ai-task-runner';
import type { AtomicWriteContext } from '@/core/data/atomic-write';
import type { LocalDatabase } from '@/core/data/database-contract';
import type { ReaderRepository } from '@/modules/reader/application/ports';
import { renderReaderPrompt } from '@/modules/reader/application/prompt-renderer';
import { parseOrganizedText, ReaderAiCoordinator, registerReaderAiTasks } from '@/modules/reader/application/reader-ai';
import { LocalReaderRepository } from '@/modules/reader/data/reader-repository';
import { defaultRoleDraft, DEFAULT_READER_PROMPTS } from '@/modules/reader/domain/defaults';
import type {
  ReaderBook,
  ReaderDiscussion,
  ReaderMessage,
  ReaderPassage,
  ReaderPrompt,
  ReaderRole,
} from '@/modules/reader/domain/model';
import { normalizeReaderPrompt } from '@/modules/reader/domain/rules';

const timestamp = '2026-08-17T04:00:00.000Z';

function book(): ReaderBook {
  return {
    id: 'book-1', title: '复杂', authors: ['米歇尔·沃尔德罗普'], coverUri: '', isbn: '',
    publisher: '中信出版社', publishedAt: '', summary: '', note: '', status: 'reading',
    progress: 42, pageCount: 0, pagesRead: 0, roleId: 'reader-role-science', customPrompt: '', createdAt: timestamp,
    updatedAt: timestamp, deletedAt: null,
  };
}

function passage(): ReaderPassage {
  return {
    id: 'passage-1', bookId: 'book-1', title: '涌现', pageLabel: '42', imageUri: '',
    rawSourceText: '复杂系统的整体行为不能简单还原为组成部分。',
    sourceText: '复杂系统的整体行为不能简单还原为组成部分。', sourceRevision: 1,
    organizedSourceRevision: 0, ocrScript: 'auto', ocrBlocks: [],
    summary: '整体行为会从局部互动中涌现。', suggestedQuestions: [], analysisStatus: 'idle',
    analysisError: null, organizationStatus: 'idle', organizationError: null,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

function role(): ReaderRole {
  return {
    id: 'reader-role-science', name: '科学解释者', description: '', prompt: '解释证据和适用边界。',
    position: 0, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

function prompt(stage: ReaderPrompt['stage']): ReaderPrompt {
  return {
    id: `reader-prompt-${stage}`, stage, ...DEFAULT_READER_PROMPTS[stage],
    createdAt: timestamp, updatedAt: timestamp,
  };
}

function message(id: string, roleName: ReaderMessage['role'], content: string): ReaderMessage {
  return {
    id, discussionId: 'discussion-1', role: roleName, content, status: 'completed', favorite: false,
    collapsed: false, errorMessage: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

function discussion(): ReaderDiscussion {
  return {
    id: 'discussion-1', title: '量子力学学习路线', bookId: 'book-1', passageId: null,
    folderId: null, unread: false, lastMessagePreview: '', lastMessageStatus: 'interrupted',
    lastMessageAt: timestamp, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
}

describe('Reader rebuild contracts', () => {
  it('resolves default roles with either the storage id or the short key', () => {
    expect(defaultRoleDraft('reader-role-science')).toEqual(defaultRoleDraft('science'));
  });

  it('renders bounded prompt history and validates editable variables', () => {
    const source = { ...prompt('follow-up'), historyLimit: 2 };
    const rendered = renderReaderPrompt(source, {
      book: book(),
      passage: passage(),
      role: role(),
      question: '这个结论的边界是什么？',
      messages: [message('m1', 'user', '第一问'), message('m2', 'assistant', '第一答'), message('m3', 'user', '第二问')],
    });

    expect(rendered.system).toContain('解释证据和适用边界');
    expect(rendered.user).toContain('这个结论的边界是什么？');
    expect(rendered.history.map((item) => item.content)).toEqual(['第一答', '第二问']);
    expect(() => normalizeReaderPrompt({
      ...DEFAULT_READER_PROMPTS.analysis,
      userTemplate: '{{unknown_value}}',
    })).toThrow('未知 Prompt 变量');
  });

  it('queues passage organization and analysis under the same persistent subject', async () => {
    const repository = {
      admitPassageWork: vi.fn(async () => true),
      setPassageAnalysisRunning: vi.fn(async () => true),
    } as unknown as ReaderRepository;
    const enqueue = vi.fn<(input: Parameters<AiTaskRunner['enqueue']>[0]) => Promise<string>>(async () => 'reader-task');
    const transaction = {} as AtomicWriteContext;
    const tasks = {
      enqueue,
      admit: async <T>(operation: Parameters<AiTaskRunner['admit']>[0]) => operation({
        transaction,
        enqueue: async (input) => enqueue(input),
        cancelSubjects: async () => undefined,
      }) as Promise<T>,
    } as unknown as AiTaskRunner;
    const coordinator = new ReaderAiCoordinator(repository, () => null, tasks, () => 'service-1');

    await coordinator.organizePassage(passage());
    await coordinator.analyzePassage(passage());

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      operation: 'passage-organize',
      subjectId: 'passage-1',
      serviceId: 'service-1',
    });
    expect(enqueue.mock.calls[1]?.[0]).toMatchObject({
      operation: 'passage-analysis',
      subjectId: 'passage-1',
      serviceId: 'service-1',
    });
  });

  it('rejects duplicate passage work before another durable task is enqueued', async () => {
    const repository = {
      admitPassageWork: vi.fn(async () => false),
    } as unknown as ReaderRepository;
    const enqueue = vi.fn(async () => 'unexpected-task');
    const tasks = {
      admit: async <T>(operation: Parameters<AiTaskRunner['admit']>[0]) => operation({
        transaction: {} as AtomicWriteContext,
        enqueue,
        cancelSubjects: async () => undefined,
      }) as Promise<T>,
    } as unknown as AiTaskRunner;
    const coordinator = new ReaderAiCoordinator(repository, () => null, tasks, () => 'service-1');

    await expect(coordinator.analyzePassage(passage())).rejects.toThrow('已有 AI 任务正在进行');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('clears stale analysis when organized source commits and marks chained analysis active', async () => {
    const execute = vi.fn(async (_sql: string, _parameters: readonly unknown[] = []) => ({ rowsAffected: 1 }));
    const database = { execute } as unknown as LocalDatabase;
    const repository = new LocalReaderRepository(database, 'local', () => new Date(timestamp));

    await repository.savePassageOrganization('passage-1', 3, '  整理后的原文  ', true);

    const sql = String(execute.mock.calls[0]?.[0]);
    const parameters = execute.mock.calls[0]?.[1] as readonly unknown[];
    expect(sql).toContain("summary = ''");
    expect(sql).toContain("suggested_questions_json = '[]'");
    expect(parameters).toEqual(['　　整理后的原文', 'running', timestamp, 'passage-1', 'local', 3]);
  });

  it('preserves the OCR source when an editable passage draft omits it', async () => {
    const execute = vi.fn(async (_sql: string, _parameters: readonly unknown[] = []) => ({ rowsAffected: 1 }));
    const getOptional = vi.fn(async () => ({
      id: 'passage-1', book_id: 'book-1', title: '涌现', page_label: '42', image_uri: '',
      raw_source_text: 'OCR 原文底稿', source_text: '整理后的原文', source_revision: 1,
      organized_source_revision: 1, ocr_script: 'auto', ocr_blocks_json: '[]', summary: '摘要',
      suggested_questions_json: '[]', analysis_status: 'completed', analysis_error: null,
      organization_status: 'completed', organization_error: null, created_at: timestamp,
      updated_at: timestamp, deleted_at: null,
    }));
    const database = { execute, getOptional } as unknown as LocalDatabase;
    const repository = new LocalReaderRepository(database, 'local', () => new Date(timestamp));

    await repository.updatePassage('passage-1', {
      title: '涌现', pageLabel: '43', imageUri: '', sourceText: '用户重新整理的原文',
      ocrScript: 'auto', ocrBlocks: [],
    });

    const parameters = execute.mock.calls[0]?.[1] as readonly unknown[];
    expect(parameters[3]).toBe('OCR 原文底稿');
  });

  it('searches complete reader fields with escaped wildcards and stable pagination', async () => {
    const getAll = vi.fn(async (_sql: string, _parameters?: readonly unknown[]) => [{
      kind: 'book', id: 'book-1', book_id: 'book-1', passage_id: null, discussion_id: null,
      title: '复杂', subtitle: '["米歇尔·沃尔德罗普"]', preview: '摘要', image_uri: '', page_label: '', source_match: 0, sort_at: timestamp,
    }]);
    const database = { getAll } as unknown as LocalDatabase;
    const repository = new LocalReaderRepository(database, 'local', () => new Date(timestamp));

    await expect(repository.search('100%_', 'all', 'book-1', 25, 50)).resolves.toEqual([expect.objectContaining({ subtitle: '米歇尔·沃尔德罗普' })]);

    const sql = String(getAll.mock.calls[0]?.[0]);
    const parameters = getAll.mock.calls[0]?.[1] as readonly unknown[];
    expect(sql).toContain('raw_source_text');
    expect(sql).toContain('ORDER BY sort_at DESC, id DESC LIMIT ? OFFSET ?');
    expect(parameters).toContain('%100\\%\\_%');
    expect(parameters.slice(-2)).toEqual([25, 50]);
  });

  it('rejects a discussion whose selected book does not own its passage', async () => {
    const createDiscussion = vi.fn(async () => 'unexpected-discussion');
    const repository = {
      getPassage: vi.fn(async () => passage()),
      createDiscussion,
    } as unknown as ReaderRepository;
    const coordinator = new ReaderAiCoordinator(repository, () => null);

    await expect(coordinator.createDiscussion({
      title: '', bookId: 'book-2', passageId: 'passage-1', folderId: null, openingMessage: '为什么？',
    }, { book: null, role: null }, prompt('discussion'))).rejects.toThrow('所属书籍不一致');
    expect(createDiscussion).not.toHaveBeenCalled();
  });

  it('never falls back to a foreground request when the persistent task runner is unavailable', async () => {
    const repository = {} as ReaderRepository;
    const engine: AiEngine = { generate: vi.fn(async () => ({ text: 'unused' })) };
    const coordinator = new ReaderAiCoordinator(repository, () => engine);

    await expect(coordinator.analyzePassage(passage())).rejects.toThrow('后台任务尚未准备好');
    expect(engine.generate).not.toHaveBeenCalled();
  });

  it('waits behind organization and analyzes the latest saved source revision', async () => {
    const handlers = new Map<string, AiTaskHandler>();
    const tasks = {
      register: vi.fn((operation: string, handler: AiTaskHandler) => {
        handlers.set(operation, handler);
        return () => handlers.delete(operation);
      }),
      enqueue: vi.fn(async () => 'task-next'),
    } as unknown as AiTaskRunner;
    const current = {
      ...passage(),
      sourceText: '　　整理后的最新原文。',
      sourceRevision: 2,
      organizedSourceRevision: 2,
      organizationStatus: 'completed' as const,
    };
    const repository = {
      recoverInterruptedWork: vi.fn(async () => undefined),
      getPassage: vi.fn(async () => current),
      setPassageAnalysisRunning: vi.fn(async () => true),
      savePassageAnalysis: vi.fn(async () => true),
      setPassageAnalysisFailureIfCurrent: vi.fn(async () => undefined),
      watchBooks: (_includeDeleted: boolean, listener: (items: readonly ReaderBook[]) => void) => {
        listener([book()]); return () => undefined;
      },
      watchRoles: (listener: (items: readonly ReaderRole[]) => void) => {
        listener([role()]); return () => undefined;
      },
      watchPrompts: (listener: (items: readonly ReaderPrompt[]) => void) => {
        listener([prompt('analysis')]); return () => undefined;
      },
    } as unknown as ReaderRepository;
    const engine: AiEngine = {
      generate: vi.fn(async () => ({ text: '{"summary":"最新摘要","questions":["最新问题？","证据是什么？","边界在哪里？"]}' })),
    };
    await registerReaderAiTasks(repository, tasks, () => engine);
    const handler = handlers.get('passage-analysis');
    expect(handler).toBeDefined();

    await handler?.(aiTask({ passageId: current.id, sourceRevision: 1, useLatestSource: true }), {
      signal: new AbortController().signal,
    });

    expect(repository.setPassageAnalysisRunning).toHaveBeenCalledWith(current.id, 2);
    expect(repository.savePassageAnalysis).toHaveBeenCalledWith(current.id, '最新摘要', ['最新问题？', '证据是什么？', '边界在哪里？'], 2);
  });

  it('exposes a retry message while transient organization failure is retried', async () => {
    const handlers = new Map<string, AiTaskHandler>();
    const tasks = {
      register: vi.fn((operation: string, handler: AiTaskHandler) => {
        handlers.set(operation, handler);
        return () => handlers.delete(operation);
      }),
    } as unknown as AiTaskRunner;
    const setPassageOrganizationRetrying = vi.fn(async () => undefined);
    const setPassageOrganizationFailure = vi.fn(async () => undefined);
    const repository = {
      recoverInterruptedWork: vi.fn(async () => undefined),
      getPassage: vi.fn(async () => passage()),
      setPassageOrganizationRunning: vi.fn(async () => true),
      setPassageOrganizationRetrying,
      setPassageOrganizationFailure,
      watchPrompts: (listener: (items: readonly ReaderPrompt[]) => void) => {
        listener([prompt('organize')]); return () => undefined;
      },
    } as unknown as ReaderRepository;
    const engine: AiEngine = {
      generate: vi.fn(async () => {
        throw new AiEngineError('timeout', 'AI 请求超时，请稍后重试');
      }),
    };
    await registerReaderAiTasks(repository, tasks, () => engine);

    await expect(handlers.get('passage-organize')?.(aiTask({
      passageId: 'passage-1', sourceRevision: 1,
    }), { signal: new AbortController().signal })).rejects.toMatchObject({ code: 'timeout' });

    expect(setPassageOrganizationRetrying).toHaveBeenCalledWith(
      'passage-1',
      1,
      'AI 请求超时，请稍后重试，正在自动重试（第 1/3 次）',
    );
    expect(setPassageOrganizationFailure).not.toHaveBeenCalled();
  });

  it('does not resurrect analysis after the user has stopped passage work', async () => {
    const handlers = new Map<string, AiTaskHandler>();
    const tasks = {
      register: vi.fn((operation: string, handler: AiTaskHandler) => {
        handlers.set(operation, handler);
        return () => handlers.delete(operation);
      }),
    } as unknown as AiTaskRunner;
    const stopped = {
      ...passage(),
      analysisStatus: 'interrupted' as const,
      analysisError: '用户停止了分析任务',
    };
    const repository = {
      recoverInterruptedWork: vi.fn(async () => undefined),
      getPassage: vi.fn(async () => stopped),
      setPassageAnalysisRunning: vi.fn(async () => true),
    } as unknown as ReaderRepository;
    const generate = vi.fn(async () => ({ text: '{"summary":"不应生成","questions":[]}' }));
    await registerReaderAiTasks(repository, tasks, () => ({ generate } as AiEngine));

    await handlers.get('passage-analysis')?.(aiTask({
      passageId: stopped.id, sourceRevision: stopped.sourceRevision,
    }), { signal: new AbortController().signal });

    expect(repository.setPassageAnalysisRunning).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('retries a stopped reply in place instead of appending an invisible second answer', async () => {
    const repository = {
      prepareMessageRetry: vi.fn(async () => undefined),
      appendMessage: vi.fn(async () => 'unexpected-new-answer'),
      completeMessage: vi.fn(async () => undefined),
      failMessage: vi.fn(async () => undefined),
    } as unknown as ReaderRepository;
    const engine: AiEngine = { generate: vi.fn(async () => ({ text: '重新生成的回答' })) };
    const coordinator = new ReaderAiCoordinator(repository, () => engine);

    await coordinator.retryReply(
      discussion(),
      'answer-1',
      '量子力学应该先学什么？',
      { book: book(), passage: null, role: role() },
      prompt('follow-up'),
      [message('question-1', 'user', '量子力学应该先学什么？')],
    );

    expect(repository.prepareMessageRetry).toHaveBeenCalledWith('answer-1');
    expect(repository.appendMessage).not.toHaveBeenCalled();
    expect(repository.completeMessage).toHaveBeenCalledWith('answer-1', '重新生成的回答');
  });

  it('marks a pending discussion reply interrupted when its screen unmounts', async () => {
    const failMessage = vi.fn(async () => undefined);
    const repository = {
      appendMessage: vi.fn(async () => 'answer-pending'),
      completeMessage: vi.fn(async () => undefined),
      failMessage,
    } as unknown as ReaderRepository;
    const generate = vi.fn<AiEngine['generate']>((_request, options) => new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      }));
    const engine: AiEngine = { generate };
    const coordinator = new ReaderAiCoordinator(repository, () => engine);

    const running = coordinator.sendFollowUp(
      discussion(),
      '继续解释',
      { book: book(), passage: null, role: role() },
      prompt('follow-up'),
      [],
    );
    for (let attempt = 0; attempt < 10 && !generate.mock.calls.length; attempt += 1) {
      await Promise.resolve();
    }
    expect(generate).toHaveBeenCalledOnce();
    coordinator.stopAll();

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(failMessage).toHaveBeenCalledWith('answer-pending', 'AI 请求已停止');
  });

  it('cancels passage tasks in the same transaction that trashes a book', async () => {
    const transaction = {} as AtomicWriteContext;
    const cancelSubjects = vi.fn(async () => undefined);
    const trashBook = vi.fn(async () => undefined);
    const repository = {
      listBookPassageIds: vi.fn(async () => ['passage-1', 'passage-2']),
      trashBook,
    } as unknown as ReaderRepository;
    const tasks = {
      admit: async <T>(operation: Parameters<AiTaskRunner['admit']>[0]) => operation({
        transaction,
        enqueue: async () => 'unused',
        cancelSubjects,
      }) as Promise<T>,
    } as unknown as AiTaskRunner;
    const coordinator = new ReaderAiCoordinator(repository, () => null, tasks);

    await coordinator.trashBook('book-1');

    expect(repository.listBookPassageIds).toHaveBeenCalledWith('book-1', transaction);
    expect(cancelSubjects).toHaveBeenCalledWith(['passage-1', 'passage-2'], '书籍已移入回收站');
    expect(trashBook).toHaveBeenCalledWith('book-1', transaction);
  });

  it('cancels a passage task and interrupts its domain state in one transaction', async () => {
    const transaction = {} as AtomicWriteContext;
    const cancelSubjects = vi.fn(async () => undefined);
    const interruptPassageWork = vi.fn(async () => undefined);
    const repository = { interruptPassageWork } as unknown as ReaderRepository;
    const tasks = {
      admit: async <T>(operation: Parameters<AiTaskRunner['admit']>[0]) => operation({
        transaction,
        enqueue: async () => 'unused',
        cancelSubjects,
      }) as Promise<T>,
    } as unknown as AiTaskRunner;
    const coordinator = new ReaderAiCoordinator(repository, () => null, tasks);

    await coordinator.stopPassage('passage-1');

    expect(cancelSubjects).toHaveBeenCalledWith(['passage-1'], '用户停止了 Reader 任务');
    expect(interruptPassageWork).toHaveBeenCalledWith(
      'passage-1',
      '用户停止了整理任务',
      '用户停止了分析任务',
      transaction,
    );
  });

  it('restores only children carrying the book deletion timestamp', async () => {
    const execute = vi.fn(async (_sql: string, _parameters: readonly unknown[] = []) => ({ rowsAffected: 1 }));
    const transaction = {
      execute,
      get: vi.fn(),
      getAll: vi.fn(async () => [{ id: 'discussion-1' }]),
      getOptional: vi.fn(async () => ({ deleted_at: '2026-08-17T03:00:00.000Z' })),
    };
    const database = {
      writeTransaction: vi.fn(async (callback: (value: typeof transaction) => Promise<void>) => callback(transaction)),
    } as unknown as LocalDatabase;
    const repository = new LocalReaderRepository(database, 'local', () => new Date(timestamp));

    await repository.restoreBook('book-1');

    const restoreCalls = execute.mock.calls.filter(([sql]) => String(sql).includes('deleted_at = ?'));
    expect(restoreCalls).toHaveLength(3);
    for (const call of restoreCalls) {
      expect(String(call[0])).toContain('deleted_at = ?');
      expect(call[1]).toContain('2026-08-17T03:00:00.000Z');
    }
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('latest_assistant_message_id'),
      expect.arrayContaining(['local']),
    );
  });

  it('hydrates the Reader list from a bounded passage index instead of full OCR payloads', () => {
    const watch = vi.fn();
    const database = { watch } as unknown as LocalDatabase;
    const repository = new LocalReaderRepository(database, 'local');

    repository.watchPassageIndex(true, () => undefined, () => undefined);

    const sql = String(watch.mock.calls[0]?.[0]);
    expect(sql).toContain('substr(source_text, 1, 320) AS source_preview');
    expect(sql).toContain('substr(summary, 1, 320) AS summary_preview');
    expect(sql).not.toContain('raw_source_text');
    expect(sql).not.toContain('ocr_blocks_json');
    expect(sql).not.toContain('suggested_questions_json');
  });

  it('generates a bounded book-specific prompt through the configured AI engine', async () => {
    const generate = vi.fn<AiEngine['generate']>(async (request) => {
      expect(request.messages[0]?.role).toBe('system');
      expect(request.messages[0]?.content).toContain('本书专属阅读指引');
      expect(request.messages[1]?.role).toBe('user');
      expect(request.messages[1]?.content).toContain('书名：复杂');
      return { text: '```\n请以科学解释者的视角……\n```' };
    });
    const coordinator = new ReaderAiCoordinator({} as ReaderRepository, () => ({ generate } as AiEngine));

    const result = await coordinator.generateBookCustomPrompt({
      title: '复杂', authors: ['米歇尔·沃尔德罗普'], publisher: '中信出版社', publishedAt: '',
      summary: '整体行为从局部互动涌现。', note: '', roleName: '科学解释者', roleDescription: '解释证据和适用边界。',
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0]?.[0].temperature).toBe(0.6);
    expect(result).toBe('请以科学解释者的视角……');
  });

  describe('Reader passage organization parser', () => {
    it('parses standard JSON format', () => {
      expect(parseOrganizedText('{"text":"这是整理好的正文。"}')).toBe('这是整理好的正文。');
    });

    it('parses fenced markdown JSON with leading/trailing newlines', () => {
      const input = '\n```json\n{"text":"这是在代码块里的正文。"}\n```\n';
      expect(parseOrganizedText(input)).toBe('这是在代码块里的正文。');
    });

    it('strips think tags from reasoning models like DeepSeek R1', () => {
      const input = '<think>\n这里是推理思考过程...\n</think>\n```json\n{"text":"去除思考标签后的正文。"}\n```';
      expect(parseOrganizedText(input)).toBe('去除思考标签后的正文。');
    });

    it('tolerates unescaped raw newlines inside JSON string values', () => {
      const input = '{\n  "text": "第一段正文。\n\n第二段正文。\n第三段正文。"\n}';
      expect(parseOrganizedText(input)).toBe('第一段正文。\n\n第二段正文。\n第三段正文。');
    });

    it('supports alternative keys such as content, organized_text, cleaned_text', () => {
      expect(parseOrganizedText('{"content":"内容字段"}')).toBe('内容字段');
      expect(parseOrganizedText('{"organized_text":"整理字段"}')).toBe('整理字段');
      expect(parseOrganizedText('{"cleaned_text":"清洗字段"}')).toBe('清洗字段');
    });

    it('falls back to plain text response if model output is not JSON', () => {
      const input = '好的，为您整理如下：\n这是整理后的正文第一段。\n\n这是第二段。';
      expect(parseOrganizedText(input)).toBe('这是整理后的正文第一段。\n\n这是第二段。');
    });

    it('throws when output is empty or only whitespace', () => {
      expect(() => parseOrganizedText('')).toThrow('AI 没有返回可用的整理文本');
      expect(() => parseOrganizedText('   \n\n  ')).toThrow('AI 没有返回可用的整理文本');
      expect(() => parseOrganizedText('<think>只有思考过程</think>')).toThrow('AI 没有返回可用的整理文本');
    });
  });
});

function aiTask(payload: unknown): AiTask {
  return {
    id: 'reader-task-1', subjectId: 'passage-1', operation: 'passage-analysis',
    idempotencyKey: 'analysis:passage-1:1', serviceId: 'service-1', payload,
    status: 'running', attemptCount: 0, notBeforeAt: null, errorCode: null, errorMessage: null,
    createdAt: timestamp, updatedAt: timestamp,
  };
}
