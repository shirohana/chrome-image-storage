export interface SavedImage {
  id: string;
  blob: Blob;
  imageUrl: string;
  pageUrl: string;
  pageTitle?: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  savedAt: number;
  tags?: string[];
  isDeleted?: boolean;
}

export interface ImageMetadata {
  id: string;
  imageUrl: string;
  pageUrl: string;
  pageTitle?: string;
  mimeType: string;
  fileSize: number;
  width: number;
  height: number;
  savedAt: number;
  tags?: string[];
  isDeleted?: boolean;
}

export interface CaptureImageMessage {
  type: 'CAPTURE_IMAGE';
  imageUrl: string;
  pageUrl: string;
  pageTitle: string;
}

export interface ImageCapturedMessage {
  type: 'IMAGE_CAPTURED';
  success: boolean;
  imageId?: string;
  error?: string;
}
