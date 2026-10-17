import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
  requestMediaLibraryPermissionsAsync,
} from 'expo-image-picker';

import type { MediaImageCrop, MediaImagePurpose, MediaImageSource, MediaLibrary, StoredImage } from './media-library';

export interface NativeMediaLibraryOptions {
  directoryName: string;
}

class NativeMediaLibrary implements MediaLibrary {
  private readonly mediaDirectory: Directory;

  constructor(options: NativeMediaLibraryOptions) {
    this.mediaDirectory = new Directory(Paths.document, options.directoryName);
  }

  async selectImage(source: MediaImageSource, purpose: MediaImagePurpose): Promise<StoredImage | null> {
    const permission = source === 'camera'
      ? await requestCameraPermissionsAsync()
      : await requestMediaLibraryPermissionsAsync();
    if (!permission.granted) throw new Error(source === 'camera' ? '没有相机权限' : '没有照片访问权限');
    const result = source === 'camera'
      ? await launchCameraAsync({ mediaTypes: ['images'], quality: 1, exif: false })
      : await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return null;
    return this.persistOptimized(asset.uri, purpose);
  }

  optimizeImage(uri: string, purpose: MediaImagePurpose): Promise<StoredImage> {
    return this.persistOptimized(uri, purpose);
  }

  rotateImage(uri: string, purpose: MediaImagePurpose): Promise<StoredImage> {
    return this.persistOptimized(uri, purpose, 90);
  }

  cropImage(uri: string, purpose: MediaImagePurpose, crop: MediaImageCrop): Promise<StoredImage> {
    return this.persistOptimized(uri, purpose, 0, crop);
  }

  async deleteImage(uri: string): Promise<void> {
    if (!isManagedMediaUri(uri, this.mediaDirectory)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  }

  private async persistOptimized(uri: string, purpose: MediaImagePurpose, rotation = 0, crop?: MediaImageCrop): Promise<StoredImage> {
    if (!this.mediaDirectory.exists) this.mediaDirectory.create({ intermediates: true, idempotent: true });
    const maxWidth = purpose === 'cover' ? 1_200 : 2_200;
    const context = ImageManipulator.manipulate(uri);
    if (rotation) context.rotate(rotation);
    if (crop) context.crop(crop);
    context.resize({ width: maxWidth });
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ compress: purpose === 'cover' ? 0.88 : 0.9, format: SaveFormat.JPEG });
    const target = new File(this.mediaDirectory, `${Date.now()}-${randomToken()}.jpg`);
    await new File(result.uri).copy(target, { overwrite: false });
    return { uri: target.uri, width: result.width, height: result.height };
  }
}

export function createNativeMediaLibrary(options: NativeMediaLibraryOptions): MediaLibrary {
  return new NativeMediaLibrary(options);
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10);
}

function isManagedMediaUri(uri: string, directory: Directory): boolean {
  return Boolean(uri) && uri.startsWith(`${directory.uri.replace(/\/$/u, '')}/`);
}
