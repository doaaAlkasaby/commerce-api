import { z } from 'zod';

import { BannerTargetType } from '../../generated/prisma/client.js';

export const bannerIdParamsSchema = z.object({
  id: z.string().uuid(),
});

export const createBannerSchema = z.object({
  title: z
    .string()
    .trim()
    .max(150)
    .nullable()
    .optional(),

  subtitle: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),

  imageStorageKey: z
    .string()
    .trim()
    .min(1)
    .max(500),

  imageUrl: z
    .string()
    .url()
    .max(2000),

  mobileImageStorageKey: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),

  mobileImageUrl: z
    .string()
    .url()
    .max(2000)
    .nullable()
    .optional(),

  targetType: z
    .nativeEnum(BannerTargetType)
    .default(BannerTargetType.NONE),

  targetId: z
    .string()
    .uuid()
    .nullable()
    .optional(),

  actionUrl: z
    .string()
    .url()
    .max(2000)
    .nullable()
    .optional(),

  sortOrder: z
    .number()
    .int()
    .min(0)
    .optional(),

  startsAt: z
    .coerce
    .date()
    .nullable()
    .optional(),

  endsAt: z
    .coerce
    .date()
    .nullable()
    .optional(),

  isActive: z.boolean().optional(),
});

export const updateBannerSchema =
  createBannerSchema.partial();