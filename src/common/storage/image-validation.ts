import {
  AppError,
} from '../errors/app-error.js';

const signatures = {
  jpeg: Buffer.from([
    0xff,
    0xd8,
    0xff,
  ]),

  png: Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
  ]),

  gif87a: Buffer.from(
    'GIF87a',
    'ascii',
  ),

  gif89a: Buffer.from(
    'GIF89a',
    'ascii',
  ),

  webp: Buffer.from(
    'WEBP',
    'ascii',
  ),
};

const startsWith = (
  buffer: Buffer,
  signature: Buffer,
): boolean => {
  return buffer.subarray(
    0,
    signature.length,
  ).equals(signature);
};

export const validateImageBuffer = (
  buffer: Buffer,
  contentType: string,
): void => {
  if (
    contentType ===
    'image/jpeg'
  ) {
    if (
      !startsWith(
        buffer,
        signatures.jpeg,
      )
    ) {
      throw new AppError(
        'Invalid JPEG image',
        400,
        'INVALID_IMAGE_FILE',
      );
    }

    return;
  }

  if (
    contentType ===
    'image/png'
  ) {
    if (
      !startsWith(
        buffer,
        signatures.png,
      )
    ) {
      throw new AppError(
        'Invalid PNG image',
        400,
        'INVALID_IMAGE_FILE',
      );
    }

    return;
  }

  if (
    contentType ===
    'image/gif'
  ) {
    const valid =
      startsWith(
        buffer,
        signatures.gif87a,
      ) ||
      startsWith(
        buffer,
        signatures.gif89a,
      );

    if (!valid) {
      throw new AppError(
        'Invalid GIF image',
        400,
        'INVALID_IMAGE_FILE',
      );
    }

    return;
  }

  if (
    contentType ===
    'image/webp'
  ) {
    const hasRiff =
      buffer.subarray(
        0,
        4,
      ).toString('ascii') ===
      'RIFF';

    const hasWebp =
      buffer.subarray(
        8,
        12,
      ).toString('ascii') ===
      'WEBP';

    if (!hasRiff || !hasWebp) {
      throw new AppError(
        'Invalid WebP image',
        400,
        'INVALID_IMAGE_FILE',
      );
    }

    return;
  }

  throw new AppError(
    'Unsupported image type',
    400,
    'INVALID_IMAGE_TYPE',
  );
};