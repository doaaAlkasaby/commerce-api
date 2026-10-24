import { z } from 'zod';

const optionalNullableString = z
  .string()
  .trim()
  .min(1)
  .nullable()
  .optional();

export const createAddressSchema = z.object({
  label: optionalNullableString,

  firstName: z
    .string()
    .trim()
    .min(1)
    .max(100),

  lastName: z
    .string()
    .trim()
    .min(1)
    .max(100),

  company: optionalNullableString,

  addressLine1: z
    .string()
    .trim()
    .min(1)
    .max(255),

  addressLine2: optionalNullableString,

  city: z
    .string()
    .trim()
    .min(1)
    .max(100),

  state: optionalNullableString,

  postalCode: optionalNullableString,

  country: z
    .string()
    .trim()
    .min(2)
    .max(100),

  phone: optionalNullableString,

  isDefaultShipping: z
    .boolean()
    .optional()
    .default(false),

  isDefaultBilling: z
    .boolean()
    .optional()
    .default(false),
});

export const updateAddressSchema = z
  .object({
    label: optionalNullableString,

    firstName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    lastName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    company: optionalNullableString,

    addressLine1: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional(),

    addressLine2: optionalNullableString,

    city: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional(),

    state: optionalNullableString,

    postalCode: optionalNullableString,

    country: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional(),

    phone: optionalNullableString,

    isDefaultShipping: z
      .boolean()
      .optional(),

    isDefaultBilling: z
      .boolean()
      .optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: 'At least one field must be provided',
    },
  );

export const addressIdParamsSchema = z.object({
  id: z.string().uuid(),
});