import { z } from 'zod';

export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, 'First name is required')
    .max(
      100,
      'First name must not exceed 100 characters',
    )
    .optional(),

  lastName: z
    .string()
    .trim()
    .min(1, 'Last name is required')
    .max(
      100,
      'Last name must not exceed 100 characters',
    )
    .optional(),
});

export type UpdateProfileRequest =
  z.infer<typeof updateProfileSchema>;


 export const updateUserStatusSchema =
  z.object({
    isActive: z.boolean(),
  });

export type UpdateUserStatusRequest =
  z.infer<
    typeof updateUserStatusSchema
  >; 