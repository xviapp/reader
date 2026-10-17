import { describe, expect, it, vi } from 'vitest';

import { saveReaderBookForm } from '@/modules/reader/ui/book-form-save';
import type { ReaderBookDraft } from '@/modules/reader/domain/model';

const draft: ReaderBookDraft = {
  title: '第二本书',
  authors: [],
  coverUri: 'file:///covers/second.jpg',
  isbn: '',
  publisher: '',
  publishedAt: '',
  summary: '',
  note: '',
  status: 'unread',
  progress: 0,
  pageCount: 0,
  pagesRead: 0,
  roleId: 'reader-role-general',
  customPrompt: '',
};

describe('Reader book form save lifecycle', () => {
  it('cleans up temporary media before navigating away from the form', async () => {
    const calls: string[] = [];

    await saveReaderBookForm({
      draft,
      previousCover: '',
      temporaryUri: 'file:///covers/unused.jpg',
      persist: async () => {
        calls.push('persist');
        return 'reader-book-2';
      },
      deleteImage: async () => { calls.push('delete-unused-image'); },
      onSaved: () => { calls.push('navigate'); },
    });

    expect(calls).toEqual(['persist', 'delete-unused-image', 'navigate']);
  });

  it('keeps the chosen cover and draft when persistence fails', async () => {
    const deleteImage = vi.fn(async () => undefined);
    const onSaved = vi.fn();

    await expect(saveReaderBookForm({
      draft,
      previousCover: '',
      temporaryUri: draft.coverUri,
      persist: async () => { throw new Error('write failed'); },
      deleteImage,
      onSaved,
    })).rejects.toThrow('write failed');

    expect(deleteImage).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('does not delete the chosen cover after a successful save', async () => {
    const deleteImage = vi.fn(async () => undefined);

    await saveReaderBookForm({
      draft,
      previousCover: '',
      temporaryUri: draft.coverUri,
      persist: async () => 'reader-book-2',
      deleteImage,
      onSaved: () => undefined,
    });

    expect(deleteImage).not.toHaveBeenCalled();
  });
});
