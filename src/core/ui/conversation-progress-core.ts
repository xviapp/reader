export const READING_PROGRESS_SCHEMA_VERSION = 3;
export const CONVERSATION_LATEST_THRESHOLD = 56;

export interface ReadingProgressEntry {
  anchorId: string | null;
  anchorOffset: number;
  anchorIndex: number;
  atLatest: boolean;
  readId: string | null;
  pageIndex: number;
  normalizedProgress: number;
  contentRevision: string | null;
  updatedAt: string;
}

export interface ReadingProgressDocument {
  schemaVersion: typeof READING_PROGRESS_SCHEMA_VERSION;
  entries: Readonly<Record<string, ReadingProgressEntry>>;
}

export interface ConversationItemLayout {
  id: string;
  y: number;
  height: number;
}

export interface ConversationViewportSnapshot {
  contentHeight: number;
  latestReadableId: string | null;
  layouts: readonly ConversationItemLayout[];
  viewportHeight: number;
  viewportOffset: number;
}

export type ConversationViewportCheckpoint = Pick<ReadingProgressEntry,
  'anchorId' | 'anchorOffset' | 'anchorIndex' | 'atLatest'>
  & Partial<Pick<ReadingProgressEntry, 'readId'>>;

export type ReadingProgressPatch = Partial<Pick<ReadingProgressEntry,
  'anchorId' | 'anchorOffset' | 'anchorIndex' | 'atLatest' | 'readId' | 'pageIndex' | 'normalizedProgress' | 'contentRevision'>>;

export function emptyReadingProgressDocument(): ReadingProgressDocument {
  return { schemaVersion: READING_PROGRESS_SCHEMA_VERSION, entries: {} };
}

export function normalizeReadingProgressDocument(value: unknown): ReadingProgressDocument {
  if (!isRecord(value) || value.schemaVersion !== READING_PROGRESS_SCHEMA_VERSION || !isRecord(value.entries)) {
    return emptyReadingProgressDocument();
  }
  const entries: Record<string, ReadingProgressEntry> = {};
  for (const [key, candidate] of Object.entries(value.entries)) {
    if (!safeKey(key) || !isRecord(candidate)) continue;
    entries[key] = {
      anchorId: safeId(candidate.anchorId),
      anchorOffset: nonNegativeFinite(candidate.anchorOffset),
      anchorIndex: nonNegativeInteger(candidate.anchorIndex),
      atLatest: candidate.atLatest === true,
      readId: safeId(candidate.readId),
      pageIndex: nonNegativeInteger(candidate.pageIndex),
      normalizedProgress: unitInterval(candidate.normalizedProgress),
      contentRevision: safeId(candidate.contentRevision),
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date(0).toISOString(),
    };
  }
  return { schemaVersion: READING_PROGRESS_SCHEMA_VERSION, entries };
}

export function mergeReadingProgressEntry(
  existing: ReadingProgressEntry | null,
  patch: ReadingProgressPatch,
  updatedAt: string,
): ReadingProgressEntry {
  return normalizeReadingProgressDocument({
    schemaVersion: READING_PROGRESS_SCHEMA_VERSION,
    entries: {
      entry: { ...(existing ?? defaultReadingProgressEntry()), ...patch, updatedAt },
    },
  }).entries.entry ?? defaultReadingProgressEntry();
}

export function defaultReadingProgressEntry(): ReadingProgressEntry {
  return {
    anchorId: null,
    anchorOffset: 0,
    anchorIndex: 0,
    atLatest: true,
    readId: null,
    pageIndex: 0,
    normalizedProgress: 0,
    contentRevision: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function conversationHasUnread(
  entry: ReadingProgressEntry | null,
  latestReadableId: string | null,
): boolean {
  return latestReadableId !== null && entry !== null && entry.readId !== latestReadableId;
}

export function conversationAnchorForOffset(
  layouts: readonly ConversationItemLayout[],
  offset: number,
): Pick<ReadingProgressEntry, 'anchorId' | 'anchorOffset' | 'anchorIndex'> {
  const ordered = [...layouts]
    .filter((layout) => Number.isFinite(layout.y) && Number.isFinite(layout.height) && layout.height > 0)
    .sort((left, right) => left.y - right.y);
  if (ordered.length === 0) return { anchorId: null, anchorOffset: 0, anchorIndex: 0 };
  const targetIndex = ordered.findIndex((layout) => layout.y + layout.height > offset);
  const anchorIndex = targetIndex >= 0 ? targetIndex : ordered.length - 1;
  const target = ordered[anchorIndex]!;
  return {
    anchorId: target.id,
    anchorOffset: Math.max(0, Math.min(target.height, offset - target.y)),
    anchorIndex,
  };
}

export function offsetForConversationAnchor(
  entry: Pick<ReadingProgressEntry, 'anchorId' | 'anchorOffset' | 'anchorIndex'>,
  layouts: readonly ConversationItemLayout[],
  messageIds: readonly string[] = [],
): number | null {
  const fallbackId = messageIds.length > 0
    ? messageIds[Math.min(entry.anchorIndex, messageIds.length - 1)] ?? null
    : null;
  const targetId = entry.anchorId && layouts.some((candidate) => candidate.id === entry.anchorId)
    ? entry.anchorId
    : fallbackId;
  if (!targetId) return null;
  const layout = layouts.find((candidate) => candidate.id === targetId);
  if (!layout || !Number.isFinite(layout.y) || !Number.isFinite(layout.height) || layout.height <= 0) return null;
  return Math.max(0, layout.y + Math.min(layout.height, nonNegativeFinite(entry.anchorOffset)));
}

export function conversationRestoreCanProceed(
  messageIds: readonly string[],
  layouts: readonly ConversationItemLayout[],
  deadlineReached: boolean,
): boolean {
  if (deadlineReached) return true;
  const measuredIds = new Set(layouts.map((layout) => layout.id));
  return messageIds.every((id) => measuredIds.has(id));
}

export function shouldRestoreConversationAnchor(entry: ReadingProgressEntry | null): boolean {
  return entry?.anchorId !== null && entry?.anchorId !== undefined;
}

export function latestConversationItemIsReadable(
  layout: ConversationItemLayout | null,
  viewportOffset: number,
  viewportHeight: number,
  minimumVisiblePixels = 48,
): boolean {
  if (!layout || viewportHeight <= 0 || layout.height <= 0) return false;
  const viewportBottom = viewportOffset + viewportHeight;
  const required = Math.min(layout.height, Math.max(1, minimumVisiblePixels));
  return layout.y >= viewportOffset - 1 && layout.y + required <= viewportBottom;
}

export function conversationCheckpointForViewport({
  contentHeight,
  latestReadableId,
  layouts,
  viewportHeight,
  viewportOffset,
}: ConversationViewportSnapshot): ConversationViewportCheckpoint {
  const offset = nonNegativeFinite(viewportOffset);
  const height = nonNegativeFinite(viewportHeight);
  const atLatest = nonNegativeFinite(contentHeight) - offset - height <= CONVERSATION_LATEST_THRESHOLD;
  const latestLayout = latestReadableId
    ? layouts.find((layout) => layout.id === latestReadableId) ?? null
    : null;
  const readable = atLatest || latestConversationItemIsReadable(latestLayout, offset, height);
  return {
    ...conversationAnchorForOffset(layouts, offset + 4),
    atLatest,
    ...(readable && latestReadableId ? { readId: latestReadableId } : {}),
  };
}

export function safeReadingProgressKey(value: string): boolean {
  return safeKey(value);
}

function safeKey(value: string): boolean {
  return value.length > 0 && value.length <= 240 && /^[a-z0-9:._-]+$/u.test(value);
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 ? value : null;
}

function nonNegativeFinite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(10_000_000, value)) : 0;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function unitInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

