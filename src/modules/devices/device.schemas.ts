import { z } from 'zod';

export const registerDeviceSchema = z.object({
  token: z
    .string()
    .trim()
    .min(1, 'Device token is required')
    .max(4096, 'Device token is too long'),

  platform: z.enum(['ANDROID', 'IOS']),

  appVersion: z
    .string()
    .trim()
    .max(50, 'App version must not exceed 50 characters')
    .optional(),
});

export const deviceIdParamSchema = z.object({
  deviceId: z.uuid(),
});

export type RegisterDeviceRequest = z.infer<
  typeof registerDeviceSchema
>;