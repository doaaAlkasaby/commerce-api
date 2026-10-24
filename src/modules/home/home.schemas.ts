import { z } from 'zod';

export const homeQuerySchema = z.object({
  platform: z
    .enum(['mobile', 'web'])
    .default('mobile'),
});

export type HomeQuery = z.infer<
  typeof homeQuerySchema
>;