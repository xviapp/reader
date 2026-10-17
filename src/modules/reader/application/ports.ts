import type {
  ReaderBook,
  ReaderBackupSnapshot,
  ReaderBookDraft,
  ReaderDiscussion,
  ReaderDiscussionDraft,
  ReaderFolder,
  ReaderMessage,
  ReaderMessageSource,
  ReaderPassage,
  ReaderPassageOrganizationCandidate,
  ReaderPassageDraft,
  ReaderPassageIndex,
  ReaderPreferences,
  ReaderPrompt,
  ReaderPromptDraft,
  ReaderPromptStage,
  ReaderReadingSession,
  ReaderReadingSessionDraft,
  ReaderReadingSummary,
  ReaderRole,
  ReaderRoleDraft,
  ReaderSearchResult,
} from '../domain/model';
import type { AtomicWriteContext } from '@/core/data/atomic-write';

export type ReaderUnsubscribe = () => void;

export interface ReaderBootstrapRepository {
  ensureDefaults(): Promise<void>;
}

export interface ReaderBackupRepository {
  createBackupSnapshot(): Promise<ReaderBackupSnapshot>;
  restoreBackupSnapshot(snapshot: ReaderBackupSnapshot): Promise<void>;
  replaceBackupSnapshot(snapshot: ReaderBackupSnapshot): Promise<void>;
  clearAllData(): Promise<void>;
}

export interface ReaderLibraryRepository {
  watchBooks(
    includeDeleted: boolean,
    listener: (items: readonly ReaderBook[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchPassages(
    bookId: string | null,
    includeDeleted: boolean,
    listener: (items: readonly ReaderPassage[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchPassageIndex(
    includeDeleted: boolean,
    listener: (items: readonly ReaderPassageIndex[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchPassage(
    id: string,
    listener: (item: ReaderPassage | null) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchOrganizationCandidate(
    id: string,
    listener: (item: ReaderPassageOrganizationCandidate | null) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  createBook(draft: ReaderBookDraft): Promise<string>;
  updateBook(id: string, draft: ReaderBookDraft): Promise<void>;
  createPassage(bookId: string, draft: ReaderPassageDraft): Promise<string>;
  getPassage(id: string): Promise<ReaderPassage | null>;
  updatePassage(id: string, draft: ReaderPassageDraft, expectedSourceRevision?: number): Promise<void>;
  recordReadingSession(bookId: string, draft: ReaderReadingSessionDraft): Promise<string>;
  updateReadingSession(id: string, draft: ReaderReadingSessionDraft): Promise<void>;
  deleteReadingSession(id: string): Promise<void>;
  watchReadingSummary(
    bookId: string,
    listener: (summary: ReaderReadingSummary) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchReadingSessions(
    bookId: string,
    listener: (items: readonly ReaderReadingSession[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
}

export interface ReaderSearchRepository {
  search(
    query: string,
    kind?: ReaderSearchResult['kind'] | 'all',
    bookId?: string | null,
    limit?: number,
    offset?: number,
  ): Promise<readonly ReaderSearchResult[]>;
}

export interface ReaderFolderRepository {
  watchFolders(
    listener: (items: readonly ReaderFolder[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  createFolder(name: string): Promise<string>;
  renameFolder(id: string, name: string): Promise<void>;
  deleteFolder(id: string): Promise<void>;
}

export interface ReaderDiscussionRepository {
  watchDiscussions(
    includeDeleted: boolean,
    listener: (items: readonly ReaderDiscussion[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchMessages(
    discussionId: string,
    listener: (items: readonly ReaderMessage[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  listMessages(discussionId: string): Promise<readonly ReaderMessage[]>;
  watchFavoriteMessages(
    listener: (items: readonly ReaderMessage[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  createDiscussion(draft: ReaderDiscussionDraft): Promise<string>;
  updateDiscussionFolder(id: string, folderId: string | null): Promise<void>;
  markDiscussionRead(id: string): Promise<void>;
  appendMessage(
    discussionId: string,
    role: 'user' | 'assistant',
    content: string,
    status: ReaderMessage['status'],
  ): Promise<string>;
  recordMessageSources(
    messageId: string,
    sources: readonly Pick<ReaderMessageSource, 'passageId' | 'sourceRevision'>[],
  ): Promise<void>;
  prepareMessageRetry(id: string): Promise<void>;
  completeMessage(id: string, content: string): Promise<void>;
  failMessage(id: string, message: string): Promise<void>;
  setMessageFavorite(id: string, favorite: boolean): Promise<void>;
  setMessageCollapsed(id: string, collapsed: boolean): Promise<void>;
  deleteMessagePair(questionId: string, answerId: string | null): Promise<void>;
}

export interface ReaderSettingsRepository {
  watchPrompts(
    listener: (items: readonly ReaderPrompt[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchRoles(
    listener: (items: readonly ReaderRole[]) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  watchPreferences(
    listener: (item: ReaderPreferences) => void,
    onError: (error: Error) => void,
  ): ReaderUnsubscribe;
  savePrompt(stage: ReaderPromptStage, draft: ReaderPromptDraft): Promise<void>;
  resetPrompt(stage: ReaderPromptStage): Promise<void>;
  saveRole(id: string, draft: ReaderRoleDraft): Promise<void>;
  resetRole(id: string): Promise<void>;
  savePreferences(input: ReaderPreferences): Promise<void>;
}

export interface ReaderTaskRepository {
  recoverInterruptedWork(): Promise<void>;
  admitPassageWork(
    id: string,
    expectedRevision: number,
    operation: 'organize' | 'analysis',
    transaction?: AtomicWriteContext,
  ): Promise<boolean>;
  setPassageOrganizationRunning(id: string, expectedRevision: number): Promise<boolean>;
  setPassageOrganizationRetrying(id: string, expectedRevision: number, message: string): Promise<void>;
  savePassageOrganization(
    id: string,
    expectedRevision: number,
    sourceText: string,
    queueAnalysis?: boolean,
  ): Promise<boolean>;
  savePassageOrganizationCandidate(
    id: string,
    expectedRevision: number,
    sourceText: string,
  ): Promise<boolean>;
  applyPassageOrganizationCandidate(
    id: string,
    candidateId: string,
    expectedRevision: number,
  ): Promise<boolean>;
  discardPassageOrganizationCandidate(id: string, candidateId: string): Promise<boolean>;
  setPassageOrganizationFailure(
    id: string,
    expectedRevision: number,
    message: string,
    interrupted?: boolean,
  ): Promise<void>;
  savePassageAnalysis(
    id: string,
    summary: string,
    questions: readonly string[],
    expectedRevision: number,
  ): Promise<boolean>;
  setPassageAnalysisFailureIfCurrent(
    id: string,
    expectedRevision: number,
    message: string,
    interrupted?: boolean,
  ): Promise<void>;
  setPassageAnalysisRunning(
    id: string,
    expectedRevision: number,
    transaction?: AtomicWriteContext,
  ): Promise<boolean>;
  interruptPassageWork(
    id: string,
    organizationMessage: string,
    analysisMessage: string,
    transaction?: AtomicWriteContext,
  ): Promise<void>;
}

export interface ReaderTrashRepository {
  listBookPassageIds(id: string, context?: AtomicWriteContext): Promise<readonly string[]>;
  trashBook(id: string, transaction?: AtomicWriteContext): Promise<void>;
  restoreBook(id: string, transaction?: AtomicWriteContext): Promise<void>;
  deleteBookPermanently(id: string): Promise<readonly string[]>;
  trashPassage(id: string, transaction?: AtomicWriteContext): Promise<void>;
  restorePassage(id: string, transaction?: AtomicWriteContext): Promise<void>;
  deletePassagePermanently(id: string): Promise<string | null>;
  trashDiscussion(id: string, transaction?: AtomicWriteContext): Promise<void>;
  restoreDiscussion(id: string, transaction?: AtomicWriteContext): Promise<void>;
  deleteDiscussionPermanently(id: string): Promise<void>;
}

export type ReaderWorkspaceRepository =
  & ReaderBootstrapRepository
  & Pick<ReaderLibraryRepository, 'watchBooks' | 'watchPassageIndex'>
  & Pick<ReaderDiscussionRepository, 'watchDiscussions' | 'watchFavoriteMessages'>
  & Pick<ReaderSettingsRepository, 'watchPrompts' | 'watchRoles' | 'watchPreferences'>;

/**
 * The full adapter surface used only at composition boundaries.
 * Feature modules should depend on the smallest capability interface above.
 */
export interface ReaderRepository
  extends ReaderBootstrapRepository,
    ReaderBackupRepository,
    ReaderLibraryRepository,
    ReaderSearchRepository,
    ReaderFolderRepository,
    ReaderDiscussionRepository,
    ReaderSettingsRepository,
    ReaderTaskRepository,
    ReaderTrashRepository {}
