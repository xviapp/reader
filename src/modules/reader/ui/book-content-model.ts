import type { ReaderDiscussion, ReaderMessage, ReaderPassageIndex } from '../domain/model';

export interface ReaderBookContent {
  passages: readonly ReaderPassageIndex[];
  discussions: readonly ReaderDiscussion[];
  favorites: readonly ReaderMessage[];
  deletedCount: number;
}

export function readerBookContent(
  bookId: string,
  passages: readonly ReaderPassageIndex[],
  discussions: readonly ReaderDiscussion[],
  favorites: readonly ReaderMessage[],
): ReaderBookContent {
  const activePassages = passages.filter((item) => item.bookId === bookId && item.deletedAt === null);
  const activeDiscussions = discussions.filter((item) => item.bookId === bookId && item.deletedAt === null);
  const discussionIds = new Set(activeDiscussions.map((item) => item.id));
  return {
    passages: activePassages,
    discussions: activeDiscussions,
    favorites: favorites.filter((message) => (
      message.role === 'assistant'
      && message.status === 'completed'
      && message.favorite
      && message.deletedAt === null
      && discussionIds.has(message.discussionId)
    )),
    deletedCount: passages.filter((item) => item.bookId === bookId && item.deletedAt !== null).length
      + discussions.filter((item) => item.bookId === bookId && item.deletedAt !== null).length,
  };
}
