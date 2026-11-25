import multer from 'multer';
import { AppError } from '../../common/errors/app-error.js';
import { validateImageBuffer } from '../../common/storage/image-validation.js';

export const maxAttachments = 6;
const maxBytes = 3 * 1024 * 1024;
const images = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;
const extensions: Record<string, string> = {
  ...images,
  'application/pdf': 'pdf',
};

export const requestUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxBytes,
    files: maxAttachments,
    fields: 1,
    fieldSize: 128 * 1024,
    parts: maxAttachments + 2,
  },
  fileFilter: (_req, file, callback) => {
    if (Object.hasOwn(extensions, file.mimetype)) return callback(null, true);
    callback(
      new AppError('Unsupported attachment type', 400, 'INVALID_ATTACHMENT'),
    );
  },
});

export function attachmentData(
  file: Express.Multer.File,
  productImage: boolean,
) {
  const { buffer, mimetype } = file;
  if (!buffer.length || buffer.length > maxBytes)
    throw new AppError('Invalid attachment size', 400, 'INVALID_ATTACHMENT');
  if (Object.hasOwn(images, mimetype)) {
    validateImageBuffer(buffer, mimetype);
    const complete =
      (mimetype === 'image/jpeg' &&
        buffer.length > 4 &&
        buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]))) ||
      (mimetype === 'image/png' &&
        buffer.length >= 45 &&
        buffer.subarray(12, 16).toString('ascii') === 'IHDR' &&
        buffer.subarray(-8, -4).toString('ascii') === 'IEND') ||
      (mimetype === 'image/gif' &&
        buffer.length > 13 &&
        buffer.at(-1) === 0x3b) ||
      (mimetype === 'image/webp' &&
        buffer.length >= 20 &&
        buffer.readUInt32LE(4) + 8 === buffer.length &&
        ['VP8 ', 'VP8L', 'VP8X'].includes(
          buffer.subarray(12, 16).toString('ascii'),
        ));
    if (!complete)
      throw new AppError(
        'Incomplete image attachment',
        400,
        'INVALID_ATTACHMENT',
      );
  } else if (mimetype === 'application/pdf' && !productImage) {
    const header = buffer.subarray(0, 16).toString('latin1');
    const tail = buffer.subarray(-2048).toString('latin1');
    const trailer = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
    const offset = Number(trailer?.[1]);
    const xref = buffer.subarray(offset, offset + 96).toString('latin1');
    if (
      !/^%PDF-[12]\.\d(?:\r\n|\n|\r)/.test(header) ||
      !trailer ||
      !Number.isSafeInteger(offset) ||
      offset <= 0 ||
      offset >= buffer.length ||
      !/^(?:xref\b|\d+\s+\d+\s+obj\b)/.test(xref)
    )
      throw new AppError('Invalid PDF attachment', 400, 'INVALID_ATTACHMENT');
  } else {
    throw new AppError(
      'Product attachments must be images',
      400,
      'INVALID_ATTACHMENT',
    );
  }
  return {
    contentType: mimetype,
    byteSize: buffer.length,
    content: Uint8Array.from(buffer),
  };
}

export type AttachmentData = ReturnType<typeof attachmentData>;

export function downloadFilename(id: string, contentType: string) {
  return `attachment-${id}.${extensions[contentType] ?? 'bin'}`;
}
