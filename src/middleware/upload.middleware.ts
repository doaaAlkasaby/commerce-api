import multer from 'multer';

import {
  AppError,
} from '../common/errors/app-error.js';

import { env } from '../config/env.js';

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const maxFileSize =
  env.MAX_IMAGE_SIZE_MB *
  1024 *
  1024;

export const productImageUpload =
  multer({
    storage: multer.memoryStorage(),

    limits: {
      fileSize: maxFileSize,
      files: 1,
    },

    fileFilter: (
      _req,
      file,
      callback,
    ) => {
      if (
        !allowedMimeTypes.has(
          file.mimetype,
        )
      ) {
        callback(
          new AppError(
            'Unsupported image type',
            400,
            'INVALID_IMAGE_TYPE',
          ),
        );

        return;
      }

      callback(null, true);
    },
  });