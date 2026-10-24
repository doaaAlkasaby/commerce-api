export interface StoredFile {
  storageKey: string;
  url: string;
}

export type StorageFolder =
  | 'products'
  | 'categories'
  | 'brands';

export interface StorageService {
  upload(
    file: Buffer,
    fileName: string,
    contentType: string,
    folder?: StorageFolder,
  ): Promise<StoredFile>;

  delete(
    storageKey: string,
  ): Promise<void>;
}