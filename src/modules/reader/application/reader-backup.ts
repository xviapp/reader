import { Directory, File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { APP_CONFIG } from '@/core/app-config';
import { stopReaderLanForRestore } from '../lan/application/restore-barrier';

import type { ReaderBackupRepository } from './ports';
import type { ReaderBackupSnapshot } from '../domain/model';

const BACKUP_FORMAT = 'reader-backup-v1';

interface ReaderBackupMedia {
  uri: string;
  filename: string;
  base64: string;
}

export interface ReaderBackupBundle {
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  snapshot: ReaderBackupSnapshot;
  media: readonly ReaderBackupMedia[];
}

export async function inspectReaderBackup(file: File): Promise<ReaderBackupBundle> {
  return readBundle(file);
}

export async function executeRestoreReaderBackup(
  repository: ReaderBackupRepository,
  bundle: ReaderBackupBundle,
  options?: { replace?: boolean },
): Promise<'restored'> {
  await stopReaderLanForRestore();
  const { files, uriMap } = await restoreMedia(bundle.media);
  const snapshot = bundle.snapshot;
  const mappedSnapshot = {
    ...snapshot,
    books: snapshot.books.map((book) => ({ ...book, coverUri: uriMap.get(book.coverUri) ?? book.coverUri })),
    passages: snapshot.passages.map((passage) => ({ ...passage, imageUri: uriMap.get(passage.imageUri) ?? passage.imageUri })),
  };
  try {
    if (options?.replace) {
      await repository.replaceBackupSnapshot(mappedSnapshot);
    } else {
      await repository.restoreBackupSnapshot(mappedSnapshot);
    }
  } catch (cause) {
    if (files.exists) files.delete();
    throw cause;
  }
  return 'restored';
}

export async function createReaderBackup(repository: ReaderBackupRepository): Promise<string> {
  const snapshot = await repository.createBackupSnapshot();
  const media = await collectMedia(snapshot);
  const manifest = { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), snapshot, media: media.map(({ uri, filename }) => ({ uri, filename })) };
  const archiveFiles: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest)) };
  for (const item of media) archiveFiles[`media/${item.filename}`] = decodeBase64(item.base64);
  const file = new File(Paths.cache, `reader-backup-v1-${dateToken()}.zip`);
  if (file.exists) file.delete();
  file.write(zipSync(archiveFiles, { level: 6 }));
  if (!await isAvailableAsync()) throw new Error('系统分享不可用，请稍后重试');
  await shareAsync(file.uri, { dialogTitle: '备份阅读资料', mimeType: 'application/zip' });
  return file.uri;
}

/** Opens the Android file picker, validates an owned backup, and restores it only into an empty workspace. */
export async function restoreReaderBackup(repository: ReaderBackupRepository): Promise<'cancelled' | 'restored'> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/zip', 'application/json', 'application/octet-stream'] });
  if (picked.canceled || !picked.result) return 'cancelled';
  const bundle = await inspectReaderBackup(picked.result);
  return executeRestoreReaderBackup(repository, bundle);
}

async function collectMedia(snapshot: ReaderBackupSnapshot): Promise<readonly ReaderBackupMedia[]> {
  const uris = new Set<string>();
  for (const book of snapshot.books) if (book.coverUri) uris.add(book.coverUri);
  for (const passage of snapshot.passages) if (passage.imageUri) uris.add(passage.imageUri);
  const media: ReaderBackupMedia[] = [];
  for (const [index, uri] of [...uris].entries()) {
    const file = new File(uri);
    if (!file.exists) throw new Error(`找不到本地图片：${index + 1}`);
    media.push({ uri, filename: `image-${index + 1}.${extensionOf(file.name)}`, base64: await file.base64() });
  }
  return media;
}

async function restoreMedia(media: readonly ReaderBackupMedia[]): Promise<{ files: Directory; uriMap: Map<string, string> }> {
  const files = new Directory(Paths.document, APP_CONFIG.mediaDirectory, `restore-${Date.now()}`);
  const uriMap = new Map<string, string>();
  try {
    if (media.length) files.create({ intermediates: true, idempotent: false });
    for (const item of media) {
      if (!/^[a-z0-9._-]+$/iu.test(item.filename)) throw new Error('备份包含不安全的图片路径');
      const target = new File(files, item.filename);
      target.write(decodeBase64(item.base64));
      uriMap.set(item.uri, target.uri);
    }
    return { files, uriMap };
  } catch (cause) {
    if (files.exists) files.delete();
    throw cause;
  }
}

async function readBundle(file: File): Promise<ReaderBackupBundle> {
  const bytes = await file.bytes();
  try {
    if (bytes[0] === 0x7b) return parseBundle(JSON.parse(strFromU8(bytes)));
    const entries = unzipSync(bytes);
    const manifest = entries['manifest.json'];
    if (!manifest) throw new Error('备份缺少清单文件');
    return parseZipBundle(JSON.parse(strFromU8(manifest)), entries);
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Reader')) throw cause;
    throw new Error('无法读取 Reader 备份文件');
  }
}

function parseBundle(value: unknown): ReaderBackupBundle {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || !isRecord(value.snapshot) || !Array.isArray(value.media)) {
    throw new Error('不是有效的 Reader 备份文件');
  }
  const snapshot = parseSnapshot(value.snapshot);
  const media = value.media.filter(isBackupMedia);
  if (media.length !== value.media.length) throw new Error('Reader 备份图片清单无效');
  return { format: BACKUP_FORMAT, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', snapshot, media };
}

function parseZipBundle(value: unknown, entries: Record<string, Uint8Array>): ReaderBackupBundle {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || !isRecord(value.snapshot) || !Array.isArray(value.media)) {
    throw new Error('Reader 备份内容不完整');
  }
  const media: ReaderBackupMedia[] = [];
  for (const item of value.media) {
    if (!isRecord(item) || typeof item.uri !== 'string' || typeof item.filename !== 'string') throw new Error('Reader 备份图片清单无效');
    const bytes = entries[`media/${item.filename}`];
    if (!bytes) throw new Error('Reader 备份缺少图片文件');
    media.push({ uri: item.uri, filename: item.filename, base64: encodeBase64(bytes) });
  }
  return { format: BACKUP_FORMAT, createdAt: typeof value.createdAt === 'string' ? value.createdAt : '', snapshot: parseSnapshot(value.snapshot), media };
}

function parseSnapshot(value: unknown): ReaderBackupSnapshot {
  const snapshot = value as Partial<ReaderBackupSnapshot>;
  if (!snapshot || snapshot.formatVersion !== 1 || !Array.isArray(snapshot.books) || !Array.isArray(snapshot.passages)
    || !Array.isArray(snapshot.folders) || !Array.isArray(snapshot.discussions) || !Array.isArray(snapshot.messages)
    || !Array.isArray(snapshot.prompts) || !Array.isArray(snapshot.roles)) throw new Error('Reader 备份内容不完整');
  return snapshot as ReaderBackupSnapshot;
}

function isBackupMedia(value: unknown): value is ReaderBackupMedia {
  return isRecord(value) && typeof value.uri === 'string' && typeof value.filename === 'string' && typeof value.base64 === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function extensionOf(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  return extension && /^[a-z0-9]{1,5}$/u.test(extension) ? extension : 'jpg';
}

function dateToken(): string {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}
