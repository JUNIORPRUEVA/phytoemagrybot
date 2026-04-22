export interface UploadableStorageFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface StoredFileResult {
  key: string;
  publicUrl: string;
  contentType: string;
}