import type { LanBook, LanBookIndex, LanDiscussion, LanDiscussionIndex, LanFolder, LanMessage, LanMessageIndex,
  LanPage, LanPassage, LanPassageIndex, LanSearchResult } from '../contracts';

export type LanParameters = Readonly<Record<string, string>>;
export interface ReaderLanReadPort {
  books(parameters: LanParameters): Promise<LanPage<LanBookIndex>>;
  book(parameters: LanParameters): Promise<LanBook>;
  passages(parameters: LanParameters): Promise<LanPage<LanPassageIndex>>;
  passage(parameters: LanParameters): Promise<LanPassage>;
  folders(parameters: LanParameters): Promise<readonly LanFolder[]>;
  discussions(parameters: LanParameters): Promise<LanPage<LanDiscussionIndex>>;
  discussion(parameters: LanParameters): Promise<LanDiscussion>;
  messages(parameters: LanParameters): Promise<LanPage<LanMessageIndex>>;
  message(parameters: LanParameters): Promise<LanMessage>;
  favorites(parameters: LanParameters): Promise<LanPage<LanMessageIndex>>;
  search(parameters: LanParameters): Promise<LanPage<LanSearchResult>>;
}
