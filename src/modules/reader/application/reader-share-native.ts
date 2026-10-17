import { Directory, File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { Share } from 'react-native';

import { APP_CONFIG } from '@/core/app-config';

import type { ReaderBook, ReaderPassage } from '../domain/model';
import { readerShareImageName, type ReaderTextShare } from './reader-share';

export async function shareReaderText(content: ReaderTextShare): Promise<void> {
  await Share.share(content, { dialogTitle: '分享', subject: content.title });
}

export async function shareReaderImage(book: Pick<ReaderBook, 'title' | 'authors'>, passage: Pick<ReaderPassage, 'title' | 'pageLabel' | 'imageUri'>): Promise<void> {
  if (!await isAvailableAsync()) throw new Error('系统分享不可用');
  const owned = new Directory(Paths.document, APP_CONFIG.mediaDirectory);
  const prefix = `${owned.uri.replace(/\/$/u, '')}/`;
  if (!passage.imageUri.startsWith(prefix) || /[\\/]|%2f|%5c/i.test(passage.imageUri.slice(prefix.length))) throw new Error('无法分享这张图片，请重新采集');
  const original = new File(passage.imageUri);
  if (!original.exists) throw new Error('原图不存在，请重新采集');
  const extension = original.name.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  if (!extension || !mimeTypes[extension]) throw new Error('不支持分享这种图片格式');
  const directory = new Directory(Paths.cache, `reader-share-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  directory.create();
  const copy = new File(directory, readerShareImageName(book, passage, extension));
  await original.copy(copy, { overwrite: false });
  // Keep the cache copy alive: Android's chooser may return before the receiver reads it.
  await shareAsync(copy.uri, { mimeType: mimeTypes[extension], dialogTitle: '分享原图' });
}
