import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { LanReadError } from '../contracts';

interface MediaReference { kind: 'book' | 'passage'; id: string; version: string }
const digest = (uri: string) => bytesToHex(sha256(utf8ToBytes(uri)));

/** Stateless opaque identifiers contain no file name or URI. Authentication is separate. */
export function mediaId(kind: MediaReference['kind'], id: string, uri: string): string | null {
  if (!uri.startsWith('file:///')) return null;
  const value = JSON.stringify({ kind, id, version: digest(uri) });
  let encoded = '';
  for (let i = 0; i < value.length; i++) encoded += value.charCodeAt(i).toString(16).padStart(4, '0');
  return encoded;
}

export function parseMediaId(value: string): MediaReference {
  try {
    if (!/^(?:[a-f0-9]{4}){1,500}$/u.test(value)) throw new Error();
    let decoded = '';
    for (let i = 0; i < value.length; i += 4) decoded += String.fromCharCode(parseInt(value.slice(i, i + 4), 16));
    const reference = JSON.parse(decoded) as MediaReference;
    if (!reference || Object.keys(reference).sort().join() !== 'id,kind,version'
      || !['book', 'passage'].includes(reference.kind) || typeof reference.id !== 'string'
      || !reference.id || reference.id.length > 200 || !/^[a-f0-9]{64}$/u.test(reference.version)) throw new Error();
    return reference;
  } catch { throw new LanReadError('NOT_FOUND'); }
}

export function authorizeMediaUri(reference: MediaReference, currentUri: string): { uri: string } {
  if (!currentUri.startsWith('file:///') || digest(currentUri) !== reference.version) throw new LanReadError('NOT_FOUND');
  // Native validates the canonical root and image type again when opening the file.
  return { uri: currentUri };
}
