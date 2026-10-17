/** APK and browser protocol version; independent of the application version. */
export const READER_LAN_PROTOCOL_VERSION = 1;
export const READER_LAN_DEFAULT_PORT = 9527;
export const READER_LAN_MAX_PAGES = 3;

export type LanStopReason = 'manual' | 'notification' | 'network-changed' | 'database-unavailable'
  | 'restore' | 'context-lost' | 'health-timeout' | 'start-failed';
export type LanPhase = 'stopped' | 'starting' | 'running' | 'stopping';

export interface LanService {
  serviceId: string;
  address: string;
  code: string;
}

export interface LanSnapshot {
  phase: LanPhase;
  service: LanService | null;
  connectedPages: number;
  lastStopReason: LanStopReason | null;
  error: string | null;
}

export interface LanEnvelope<T> {
  protocolVersion: typeof READER_LAN_PROTOCOL_VERSION;
  serviceId: string;
  data: T;
}

export interface LanBookIndex {
  id: string;
  title: string;
  authors: readonly string[];
  status: 'unread' | 'reading' | 'finished';
  /** Null while the book's page count or pages read is unknown. */
  progress: number | null;
  updatedAt: string;
  coverId: string | null;
}

export interface LanBook extends LanBookIndex {
  isbn: string; publisher: string; publishedAt: string; summary: string; note: string;
  createdAt: string; passageCount: number; discussionCount: number;
}
export type LanAnalysisStatus = 'idle' | 'running' | 'completed' | 'failed' | 'interrupted';
export type LanOrganizationStatus = LanAnalysisStatus | 'queued' | 'candidate';
export type LanMessageStatus = 'pending' | 'completed' | 'failed' | 'interrupted';
export interface LanPassageIndex {
  id: string; bookId: string; title: string; pageLabel: string; imageId: string | null;
  sourcePreview: string; summaryPreview: string; sourceRevision: number;
  analysisStatus: LanAnalysisStatus; organizationStatus: LanOrganizationStatus;
  createdAt: string; updatedAt: string;
}
export interface LanPassage extends LanPassageIndex {
  bookTitle: string; rawSourceText: string; sourceText: string; summary: string;
  suggestedQuestions: readonly string[]; discussionCount: number;
}
export interface LanFolder { id: string; name: string; position: number }
export interface LanDiscussionIndex {
  id: string; title: string; bookId: string | null; bookTitle: string | null; folderId: string | null;
  unread: boolean; lastMessagePreview: string; lastMessageStatus: LanMessageStatus | null;
  lastMessageAt: string; createdAt: string; updatedAt: string;
}
export interface LanSource {
  passageId: string | null; bookId: string | null; title: string;
  sourceRevision: number | null; currentRevision: number | null;
  state: 'available' | 'updated' | 'unavailable';
}
export interface LanDiscussion extends LanDiscussionIndex { sources: readonly LanSource[] }
export interface LanMessageIndex {
  id: string; discussionId: string; discussionTitle: string; bookId: string | null;
  role: 'user' | 'assistant'; content: string; hasMoreContent: boolean;
  status: LanMessageStatus; favorite: boolean; createdAt: string; updatedAt: string;
}
export interface LanMessage extends LanMessageIndex { sources: readonly LanSource[] }
export type LanSearchKind = 'book' | 'passage' | 'discussion' | 'message';
export interface LanSearchResult {
  kind: LanSearchKind; id: string; bookId: string | null; discussionId: string | null;
  title: string; subtitle: string; snippet: string; match: 'source' | 'text'; imageId: string | null;
}
export interface LanLiveReply {
  messageId: string; discussionId: string; generationId: string | null; version: number;
  text: string; state: 'generating' | 'committing'; previewAvailable: boolean;
}
export interface LanReplyEvent {
  type: 'reply-delta' | 'reply-state'; discussionId: string; messageId: string; generationId: string;
  version: number; offset?: number; delta?: string;
  state?: 'generating' | 'committing' | 'completed' | 'failed'; previewAvailable?: boolean;
}

export interface LanPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

/** Finite named SELECT operations. Media returns a private native-adapter result, never HTTP JSON. */
export interface LanReadRequest {
  serviceId: string;
  requestId: string;
  query: 'books' | 'book' | 'passages' | 'passage' | 'folders' | 'discussions' | 'discussion'
    | 'messages' | 'message' | 'favorites' | 'search' | 'live-replies' | 'media';
  parameters: Record<string, string>;
}

export interface LanEvent {
  serviceId: string;
  changeSeq: number;
  protocolVersion?: number;
  connectionId?: string;
  sourceReady?: boolean;
  reason?: LanStopReason;
}

export class LanReadError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'DATA_UNAVAILABLE' | 'NOT_FOUND') {
    super(code);
  }
}
