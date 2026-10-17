export type ReaderBookStatus = 'unread' | 'reading' | 'finished';
export type ReaderOcrScript = 'auto' | 'chinese' | 'latin';
export type ReaderAnalysisStatus = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted';
export type ReaderOrganizationStatus = 'idle' | 'queued' | 'running' | 'candidate' | 'completed' | 'failed' | 'interrupted';
export type ReaderMessageStatus = 'pending' | 'completed' | 'failed' | 'interrupted';
export type ReaderPromptStage = 'analysis' | 'organize' | 'discussion' | 'follow-up';

export interface ReaderBook {
  id: string;
  title: string;
  authors: readonly string[];
  coverUri: string;
  isbn: string;
  publisher: string;
  publishedAt: string;
  summary: string;
  note: string;
  status: ReaderBookStatus;
  /** Derived from pagesRead / pageCount on every write; 0 when either is unknown. */
  progress: number;
  pageCount: number;
  pagesRead: number;
  roleId: string;
  customPrompt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReaderOcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReaderOcrBlock {
  text: string;
  confidence: number | null;
  box: ReaderOcrBox;
}

export interface ReaderPassage {
  id: string;
  bookId: string;
  title: string;
  pageLabel: string;
  imageUri: string;
  /** Latest OCR output. It is never replaced by manual cleanup. */
  rawSourceText: string;
  sourceText: string;
  sourceRevision: number;
  organizedSourceRevision: number;
  ocrScript: ReaderOcrScript;
  ocrBlocks: readonly ReaderOcrBlock[];
  summary: string;
  suggestedQuestions: readonly string[];
  analysisStatus: ReaderAnalysisStatus;
  analysisError: string | null;
  organizationStatus: ReaderOrganizationStatus;
  organizationError: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** A generated rewrite that is kept separate from the reader-visible source until the user applies it. */
export interface ReaderPassageOrganizationCandidate {
  id: string;
  passageId: string;
  sourceRevision: number;
  sourceText: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderPassageIndex {
  id: string;
  bookId: string;
  title: string;
  pageLabel: string;
  imageUri: string;
  sourcePreview: string;
  summaryPreview: string;
  sourceRevision: number;
  analysisStatus: ReaderAnalysisStatus;
  analysisError: string | null;
  organizationStatus: ReaderOrganizationStatus;
  organizationError: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReaderFolder {
  id: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReaderDiscussion {
  id: string;
  title: string;
  bookId: string | null;
  passageId: string | null;
  /** Canonical ordered discussion sources; legacy passage arrays remain for backup compatibility. */
  sources?: readonly ReaderDiscussionSource[];
  /** Ordered source passages; legacy discussions may only expose passageId. */
  passageIds?: readonly string[];
  passageSourceRevisions?: readonly number[];
  folderId: string | null;
  unread: boolean;
  lastMessagePreview: string;
  lastMessageStatus: ReaderMessageStatus | null;
  latestAssistantMessageId?: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReaderDiscussionSource {
  id: string;
  discussionId: string;
  passageId: string;
  sourceRevision: number;
  position: number;
  createdAt: string;
}

export interface ReaderMessage {
  id: string;
  discussionId: string;
  role: 'user' | 'assistant';
  content: string;
  status: ReaderMessageStatus;
  favorite: boolean;
  collapsed: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReaderMessageSource {
  id: string;
  messageId: string;
  passageId: string;
  sourceRevision: number;
  position: number;
  createdAt: string;
}

export interface ReaderPrompt {
  id: string;
  stage: ReaderPromptStage;
  systemTemplate: string;
  userTemplate: string;
  includeBook: boolean;
  includeSource: boolean;
  includeSummary: boolean;
  historyLimit: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReaderRole {
  id: string;
  name: string;
  description: string;
  prompt: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReaderPreferences {
  id: string;
  ocrScript: ReaderOcrScript;
  createdAt: string;
  updatedAt: string;
}

/** A finished reading-timer session, kept with its book. */
export interface ReaderReadingSession {
  id: string;
  bookId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  /** Pages read when the session ended, before and after; null when not known. */
  startPage: number | null;
  endPage: number | null;
  createdAt: string;
}

export type ReaderReadingSessionDraft = Pick<ReaderReadingSession, 'startedAt' | 'endedAt' | 'startPage' | 'endPage'>;

export interface ReaderReadingSummary {
  sessionCount: number;
  totalMs: number;
  lastReadAt: string | null;
}

export interface ReaderBackupSnapshot {
  formatVersion: 1;
  createdAt: string;
  books: readonly ReaderBook[];
  passages: readonly ReaderPassage[];
  organizationCandidates?: readonly ReaderPassageOrganizationCandidate[];
  folders: readonly ReaderFolder[];
  discussions: readonly ReaderDiscussion[];
  discussionSources?: readonly ReaderDiscussionSource[];
  messages: readonly ReaderMessage[];
  messageSources?: readonly ReaderMessageSource[];
  prompts: readonly ReaderPrompt[];
  roles: readonly ReaderRole[];
  /** Absent in backups from before reading sessions were kept. */
  readingSessions?: readonly ReaderReadingSession[];
  preferences: ReaderPreferences | null;
}

export type ReaderSearchResultKind = 'book' | 'passage' | 'discussion' | 'message';

export interface ReaderSearchResult {
  kind: ReaderSearchResultKind;
  id: string;
  bookId: string | null;
  passageId: string | null;
  discussionId: string | null;
  title: string;
  subtitle: string;
  preview: string;
  imageUri: string;
  pageLabel: string;
  sourceMatch: boolean;
}

export interface ReaderBookDraft {
  title: string;
  authors: readonly string[];
  coverUri: string;
  isbn: string;
  publisher: string;
  publishedAt: string;
  summary: string;
  note: string;
  status: ReaderBookStatus;
  /** Derived from pagesRead / pageCount on every write; 0 when either is unknown. */
  progress: number;
  pageCount: number;
  pagesRead: number;
  roleId: string;
  customPrompt: string;
}

export interface ReaderPassageDraft {
  title: string;
  pageLabel: string;
  imageUri: string;
  rawSourceText?: string;
  sourceText: string;
  ocrScript: ReaderOcrScript;
  ocrBlocks: readonly ReaderOcrBlock[];
}

export interface ReaderDiscussionDraft {
  title: string;
  bookId: string | null;
  passageId: string | null;
  passageIds?: readonly string[];
  folderId: string | null;
  openingMessage: string;
}

export interface ReaderPromptDraft {
  systemTemplate: string;
  userTemplate: string;
  includeBook: boolean;
  includeSource: boolean;
  includeSummary: boolean;
  historyLimit: number;
}

export interface ReaderRoleDraft {
  name: string;
  description: string;
  prompt: string;
}

export interface ReaderOcrResult {
  fullText: string;
  script: ReaderOcrScript;
  blocks: readonly ReaderOcrBlock[];
}
