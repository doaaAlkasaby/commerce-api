import { z } from 'zod';

export const createTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(150),

  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Slug must contain lowercase letters, numbers and hyphens only.',
    ),

  code: z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(
      /^[A-Z0-9_]+$/,
      'Code must contain uppercase letters, numbers and underscores only.',
    ),

  legalName: z
    .string()
    .trim()
    .max(200)
    .optional(),

  defaultCountryCode: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .optional(),

  defaultCurrency: z
    .string()
    .trim()
    .length(3)
    .toUpperCase()
    .optional(),

  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),

  logoStorageKey: z
    .string()
    .trim()
    .max(500)
    .optional(),

  logoUrl: z
    .string()
    .url()
    .optional(),
});

export const updateTenantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(150)
    .optional(),

  legalName: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional(),

  defaultCountryCode: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .nullable()
    .optional(),

  defaultCurrency: z
    .string()
    .trim()
    .length(3)
    .toUpperCase()
    .nullable()
    .optional(),

  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional(),

  logoStorageKey: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional(),

  logoUrl: z
    .string()
    .url()
    .nullable()
    .optional(),
});

export const addTenantMemberSchema = z.object({
  userId: z.string().uuid(),

  role: z
    .enum([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'CUSTOMER',
    ])
    .default('CUSTOMER'),
});

export const updateTenantMemberSchema = z.object({
  role: z
    .enum([
      'OWNER',
      'ADMIN',
      'MANAGER',
      'CUSTOMER',
    ])
    .optional(),

  status: z
    .enum([
      'ACTIVE',
      'INVITED',
      'SUSPENDED',
      'REMOVED',
    ])
    .optional(),
});