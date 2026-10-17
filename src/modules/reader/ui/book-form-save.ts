import type { ReaderBookDraft } from '../domain/model';

interface ReaderBookFormSaveInput {
  draft: ReaderBookDraft;
  previousCover: string;
  temporaryUri: string | null;
  persist(draft: ReaderBookDraft, previousCover: string): Promise<string>;
  deleteImage(uri: string): Promise<void>;
  onSaved(bookId: string): void;
}

/** Keeps successful domain writes ahead of temporary media cleanup and navigation. */
export async function saveReaderBookForm(input: ReaderBookFormSaveInput): Promise<void> {
  const bookId = await input.persist(input.draft, input.previousCover);
  if (input.temporaryUri && input.temporaryUri !== input.draft.coverUri) {
    await input.deleteImage(input.temporaryUri);
  }
  input.onSaved(bookId);
}
