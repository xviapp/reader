import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareReaderImage, shareReaderText } from '@/modules/reader/application/reader-share-native';

const mocks = vi.hoisted(() => ({
  available: vi.fn(async () => true),
  shareFile: vi.fn(async () => undefined),
  shareText: vi.fn(async () => ({ action: 'sharedAction' })),
  copy: vi.fn<(destination: { uri: string }, options?: { overwrite: boolean }) => Promise<void>>(async () => undefined),
  create: vi.fn(),
  exists: true,
}));

vi.mock('react-native', () => ({ Share: { share: mocks.shareText } }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: mocks.available, shareAsync: mocks.shareFile }));
vi.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(base: string | { uri: string }, name: string) { this.uri = `${typeof base === 'string' ? base : base.uri}${name}/`; }
    create = mocks.create;
  }
  class File {
    uri: string;
    constructor(base: string | { uri: string }, name?: string) { this.uri = `${typeof base === 'string' ? base : base.uri}${name ?? ''}`; }
    get name() { return this.uri.split('/').pop() ?? ''; }
    get exists() { return mocks.exists; }
    copy = mocks.copy;
  }
  return { Directory, File, Paths: { document: 'file:///documents/', cache: 'file:///cache/' } };
});

const book = { title: '书名', authors: [] };
const passage = { title: '摘录', pageLabel: '第 3 页', imageUri: 'file:///documents/reader-media/photo.jpg' };

beforeEach(() => { vi.clearAllMocks(); mocks.exists = true; mocks.available.mockResolvedValue(true); });

describe('Reader native system share', () => {
  it('opens text sharing without a note-specific target', async () => {
    const text = { title: '摘录', message: '文字\n书名：书' };
    await shareReaderText(text);
    expect(mocks.shareText).toHaveBeenCalledWith(text, { dialogTitle: '分享', subject: '摘录' });
  });
  it('copies the original to cache and grants sharing through expo-sharing', async () => {
    await shareReaderImage(book, passage);
    expect(mocks.copy).toHaveBeenCalledOnce();
    const target = mocks.copy.mock.calls[0]?.[0] as unknown as { uri: string };
    expect(target.uri).toMatch(/^file:\/\/\/cache\/reader-share-.*\/书名-第 3 页-摘录\.jpg$/);
    expect(mocks.shareFile).toHaveBeenCalledWith(target.uri, { mimeType: 'image/jpeg', dialogTitle: '分享原图' });
    expect(mocks.copy.mock.invocationCallOrder[0]).toBeLessThan(mocks.shareFile.mock.invocationCallOrder[0]!);
  });
  it('does not share a cache file until the async copy completes', async () => {
    let finish: (() => void) | undefined;
    mocks.copy.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const result = shareReaderImage(book, passage);
    await vi.waitFor(() => expect(mocks.copy).toHaveBeenCalledOnce());
    expect(mocks.shareFile).not.toHaveBeenCalled();
    finish!();
    await result;
    expect(mocks.shareFile).toHaveBeenCalledOnce();
  });
  it('rejects unavailable sharing, missing files and unmanaged URIs', async () => {
    mocks.available.mockResolvedValueOnce(false);
    await expect(shareReaderImage(book, passage)).rejects.toThrow('不可用');
    mocks.exists = false;
    await expect(shareReaderImage(book, passage)).rejects.toThrow('不存在');
    await expect(shareReaderImage(book, { ...passage, imageUri: 'file:///documents/secret.jpg' })).rejects.toThrow('无法分享');
    await expect(shareReaderImage(book, { ...passage, imageUri: 'file:///documents/reader-media/../secret.jpg' })).rejects.toThrow('无法分享');
    expect(mocks.shareFile).not.toHaveBeenCalled();
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it('propagates platform errors without pretending content was saved', async () => {
    mocks.shareText.mockRejectedValueOnce(new Error('分享失败'));
    await expect(shareReaderText({ title: '标题', message: '文字' })).rejects.toThrow('分享失败');
  });
});
