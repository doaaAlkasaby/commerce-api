import { z } from 'zod';

const text = z.string().trim().min(1).max(255);
export const warehouseFields = z.object({
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  name: text,
  description: z.string().trim().max(2000).nullable().optional(),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  region: text.nullable().optional(),
  city: text,
  address: text,
  latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  priority: z.number().int().min(0).max(2147483647).optional(),
});
const coordinates = (
  data: {
    latitude?: number | null | undefined;
    longitude?: number | null | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if ((data.latitude != null) !== (data.longitude != null))
    ctx.addIssue({
      code: 'custom',
      path: ['latitude'],
      message: 'Both coordinates are required together',
    });
};
export const createWarehouseSchema = warehouseFields.superRefine(coordinates);
export const updateWarehouseSchema = warehouseFields
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Provide an update');
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;
