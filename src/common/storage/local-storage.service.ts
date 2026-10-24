import {
  mkdir,
  unlink,
  writeFile,
} from 'node:fs/promises';

import path from 'node:path';

import crypto from 'node:crypto';

import { env } from '../../config/env.js';

import type {
  StorageService,
  StorageFolder,
  StoredFile,
} from './storage.types.js';

const extensionFromContentType = (
  contentType: string,
): string => {
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

export const createLocalStorageService =
  (): StorageService => {
    return {
      upload: async (
        file,
        _fileName,
        contentType,
        folder: StorageFolder = 'products',
      ): Promise<StoredFile> => {
        const extension =
          extensionFromContentType(
            contentType,
          );

        const randomName =
          `${crypto.randomUUID()}${extension}`;

        const storageKey =
          `${folder}/${randomName}`;

        const fullPath =
          path.join(
            env.UPLOAD_DIR,
            storageKey,
          );

        await mkdir(
          path.dirname(fullPath),
          {
            recursive: true,
          },
        );

        await writeFile(
          fullPath,
          file,
        );

        const url =
          `${env.UPLOAD_BASE_URL}/${storageKey}`;

        return {
          storageKey,
          url,
        };
      },

      delete: async (
        storageKey,
      ): Promise<void> => {
        const fullPath =
          path.join(
            env.UPLOAD_DIR,
            storageKey,
          );

        try {
          await unlink(fullPath);
        } catch (error) {
          const nodeError =
            error as NodeJS.ErrnoException;

          if (
            nodeError.code !==
            'ENOENT'
          ) {
            throw error;
          }
        }
      },
    };
  };