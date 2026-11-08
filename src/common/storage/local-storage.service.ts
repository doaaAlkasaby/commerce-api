import { isSafeStorageKey } from './storage-validation.js';
import { AppError } from '../errors/app-error.js';
import { mkdir, unlink, writeFile, realpath } from 'node:fs/promises';

import path from 'node:path';

import crypto from 'node:crypto';

import { env } from '../../config/env.js';

import type {
  StorageService,
  StorageFolder,
  StoredFile,
} from './storage.types.js';

function safePath(key: string): string {
  if (!isSafeStorageKey(key))
    throw new AppError('Invalid storage path', 400, 'INVALID_STORAGE_KEY');
  const root = path.resolve(env.UPLOAD_DIR),
    full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep))
    throw new AppError('Invalid storage path', 400, 'INVALID_STORAGE_KEY');
  return full;
}
async function ensureInside(filePath: string): Promise<void> {
  const root = await realpath(path.resolve(env.UPLOAD_DIR));
  const actual = await realpath(filePath);
  if (actual !== root && !actual.startsWith(root + path.sep))
    throw new AppError('Invalid storage path', 400, 'INVALID_STORAGE_KEY');
}

const extensionFromContentType = (contentType: string): string => {
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg';

    case 'image/png':
      return '.png';

    case 'image/webp':
      return '.webp';

    case 'image/gif':
      return '.gif';

    default:
      return '';
  }
};

export const createLocalStorageService = (): StorageService => {
  return {
    upload: async (
      file,
      _fileName,
      contentType,
      folder: StorageFolder = 'products',
    ): Promise<StoredFile> => {
      if (!['products', 'categories', 'brands'].includes(folder))
        throw new AppError(
          'Invalid storage folder',
          400,
          'INVALID_STORAGE_KEY',
        );
      const extension = extensionFromContentType(contentType);

      if (!extension)
        throw new AppError('Unsupported image type', 400, 'INVALID_IMAGE_TYPE');
      const randomName = `${crypto.randomUUID()}${extension}`;

      const storageKey = `${folder}/${randomName}`;

      const fullPath = safePath(storageKey);

      await mkdir(path.dirname(fullPath), {
        recursive: true,
      });

      await ensureInside(path.dirname(fullPath));
      await writeFile(fullPath, file, { flag: 'wx' });

      const url = `${env.UPLOAD_BASE_URL}/${storageKey}`;

      return {
        storageKey,
        url,
      };
    },

    delete: async (storageKey): Promise<void> => {
      const fullPath = safePath(storageKey);
      // Bundled development art is immutable and shared by several fixture records.
      // Removing/replacing a DB reference must not delete repository assets.
      if (storageKey.startsWith('development-v82/')) return;

      try {
        await ensureInside(fullPath);
        await unlink(fullPath);
      } catch (error) {
        const nodeError =
          error && typeof error === 'object' && 'code' in error
            ? error
            : { code: undefined };

        if (nodeError.code !== 'ENOENT') {
          throw error;
        }
      }
    },
  };
};
