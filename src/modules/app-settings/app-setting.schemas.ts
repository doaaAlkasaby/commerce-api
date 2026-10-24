import { z } from 'zod';

export const appSettingKeySchema = z
  .string()
  .trim()
  .min(1, 'Setting key is required')
  .max(200, 'Setting key must not exceed 200 characters')
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Setting key may contain only letters, numbers, and underscores',
  );

export const appSettingValueSchema = z.json();

export const createAppSettingSchema = z.object({
  key: appSettingKeySchema,
  value: appSettingValueSchema,
  description: z
    .string()
    .trim()
    .max(500, 'Description must not exceed 500 characters')
    .nullable()
    .optional(),
  isPublic: z.boolean().default(true),
});

export const updateAppSettingSchema = z
  .object({
    value: appSettingValueSchema.optional(),
    description: z
      .string()
      .trim()
      .max(500, 'Description must not exceed 500 characters')
      .nullable()
      .optional(),
    isPublic: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'At least one setting field must be provided',
  });

export const appSettingKeyParamSchema = z.object({
  key: appSettingKeySchema,
});

export type CreateAppSettingRequest = z.infer<typeof createAppSettingSchema>;

export type UpdateAppSettingRequest = z.infer<typeof updateAppSettingSchema>;
