import { z } from 'zod';

export const createCategorySchema =
  z.object({
    name: z
      .string()
      .trim()
      .min(
        1,
        'Category name is required',
      )
      .max(
        100,
        'Category name must not exceed 100 characters',
      ),

    slug: z
      .string()
      .trim()
      .min(
        1,
        'Category slug is required',
      )
      .max(
        120,
        'Category slug must not exceed 120 characters',
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

    parentId: z
      .string()
      .uuid('Invalid parent category ID')
      .nullable()
      .optional(),
  });

export const updateCategorySchema =
  z.object({
    name: z
      .string()
      .trim()
      .min(
        1,
        'Category name is required',
      )
      .max(
        100,
        'Category name must not exceed 100 characters',
      )
      .optional(),

    slug: z
      .string()
      .trim()
      .min(
        1,
        'Category slug is required',
      )
      .max(
        120,
        'Category slug must not exceed 120 characters',
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

    parentId: z
      .string()
      .uuid('Invalid parent category ID')
      .nullable()
      .optional(),
  });


export const categoryIdParamSchema =
  z.object({
    id: z.uuid(),
  });


export const categoryIdSchema =
  z.object({
    id: z.string().uuid(
      'Invalid category ID',
    ),
  });

export type CreateCategoryRequest =
  z.infer<typeof createCategorySchema>;

export type UpdateCategoryRequest =
  z.infer<typeof updateCategorySchema>;