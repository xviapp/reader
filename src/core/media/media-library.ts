export type MediaImageSource = 'camera' | 'library';
export type MediaImagePurpose = 'cover' | 'document';

export interface StoredImage {
  uri: string;
  width: number;
  height: number;
}

export interface MediaImageCrop {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface MediaLibrary {
  selectImage(source: MediaImageSource, purpose: MediaImagePurpose): Promise<StoredImage | null>;
  optimizeImage(uri: string, purpose: MediaImagePurpose): Promise<StoredImage>;
  rotateImage(uri: string, purpose: MediaImagePurpose): Promise<StoredImage>;
  cropImage(uri: string, purpose: MediaImagePurpose, crop: MediaImageCrop): Promise<StoredImage>;
  deleteImage(uri: string): Promise<void>;
}

