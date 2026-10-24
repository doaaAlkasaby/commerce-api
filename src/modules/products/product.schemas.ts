import { z } from 'zod';

import { ProductStatus } from '../../generated/prisma/client.js';

import { paginationQuerySchema } from '../../common/pagination/pagination.js';

const slugSchema = z
  .string()
  .trim()
  .min(1, 'Product slug is required')
  .max(200, 'Product slug must not exceed 200 characters')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug must contain lowercase letters, numbers, and hyphens only',
  );

const priceSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, 'Invalid monetary value')
  .refine((value) => Number(value) >= 0, 'Price cannot be negative');

const optionalQueryParam = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === '' ? undefined : value),
    schema.optional(),
  );

const discountSchema = z
  .object({
    type: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),

    value: priceSchema,

    startsAt: z.coerce.date().nullable().optional(),

    endsAt: z.coerce.date().nullable().optional(),
  })
  .superRefine((discount, ctx) => {
    const amount = Number(discount.value);

    if (amount <= 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Discount value must be greater than zero',
      });
    }

    if (discount.type === 'PERCENTAGE' && amount > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Percentage discount cannot exceed 100',
      });
    }

    if (
      discount.startsAt &&
      discount.endsAt &&
      discount.endsAt <= discount.startsAt
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'Discount end date must be after start date',
      });
    }
  });

export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(200),

  slug: slugSchema,

  description: z.string().trim().max(5000).nullable().optional(),

  categoryId: z.uuid(),

  brandId: z.uuid().nullable().optional(),

  basePrice: priceSchema,

  discount: discountSchema.nullable().optional(),
});

export const updateProductSchema = createProductSchema.partial();

export const productIdParamSchema = z.object({
  id: z.uuid(),
});

export const productIdSchema = productIdParamSchema;

export const productStatusSchema = z.object({
  status: z.nativeEnum(ProductStatus),
});

export const updateProductStatusSchema = productStatusSchema;

export const productListQuerySchema = paginationQuerySchema
  .extend({
    search: optionalQueryParam(z.string().trim().min(1).max(200)),

    categoryId: optionalQueryParam(z.uuid()),

    brandId: optionalQueryParam(z.uuid()),

    minPrice: optionalQueryParam(priceSchema),

    maxPrice: optionalQueryParam(priceSchema),

    sortBy: z.enum(['createdAt', 'name', 'basePrice']).default('createdAt'),

    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .refine(
    ({ minPrice, maxPrice }) =>
      minPrice === undefined ||
      maxPrice === undefined ||
      Number(minPrice) <= Number(maxPrice),
    {
      message: 'Minimum price cannot be greater than maximum price',
      path: ['minPrice'],
    },
  );

export type CreateProductRequest = z.infer<typeof createProductSchema>;

export type UpdateProductRequest = z.infer<typeof updateProductSchema>;

export type ProductListQueryRequest = z.infer<typeof productListQuerySchema>;

export const productListingQuerySchema = paginationQuerySchema;

export type ProductListingQuery = z.infer<typeof productListingQuerySchema>;
