import { z } from 'zod';

export const createBrandSchema =
  z.object({
    name: z
      .string()
      .trim()
      .min(
        1,
        'Brand name is required',
      )
      .max(
        100,
        'Brand name must not exceed 100 characters',
      ),

    slug: z
      .string()
      .trim()
      .min(
        1,
        'Brand slug is required',
      )
      .max(
        120,
        'Brand slug must not exceed 120 characters',
      )
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug must contain only lowercase letters, numbers, and hyphens',
      ),

    description: z
      .string()
      .trim()
      .max(
        1000,
        'Description must not exceed 1000 characters',
      )
      .optional(),

  });

export const updateBrandSchema =
  z.object({
    name: z
      .string()
      .trim()
      .min(
        1,
        'Brand name is required',
      )
      .max(
        100,
        'Brand name must not exceed 100 characters',
      )
      .optional(),

    slug: z
      .string()
      .trim()
      .min(
        1,
        'Brand slug is required',
      )
      .max(
        120,
        'Brand slug must not exceed 120 characters',
      )
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug must contain only lowercase letters, numbers, and hyphens',
      )
      .optional(),

    description: z
      .string()
      .trim()
      .max(
        1000,
        'Description must not exceed 1000 characters',
      )
      .nullable()
      .optional(),

  });

export const brandIdSchema =
  z.object({
    id: z.string().uuid(
      'Invalid brand ID',
    ),
  });

export type CreateBrandRequest =
  z.infer<typeof createBrandSchema>;

export type UpdateBrandRequest =
  z.infer<typeof updateBrandSchema>;