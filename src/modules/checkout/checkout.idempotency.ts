import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import { PaymentProvider } from '../../generated/prisma/client.js';
import type { CheckoutInput } from './checkout.types.js';

export function validateIdempotencyKey(value: string): string {
  const key = value.trim();
  if (!key)
    throw new AppError(
      'Idempotency-Key header is required',
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  if (!/^[\x21-\x7e]{1,255}$/.test(key)) {
    throw new AppError(
      'Idempotency-Key must contain 1–255 visible ASCII characters without spaces',
      400,
      'INVALID_IDEMPOTENCY_KEY',
    );
  }
  return key;
}

export function checkoutFingerprint(input: CheckoutInput): string {
  // Fixed property order and explicit defaults make the intent independent of
  // JSON ordering. Currency is intentionally ignored: the server controls it.
  // The cart is implicitly the authenticated user's cart in the current tenant;
  // its mutable contents must not be read again to replay a committed attempt.
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: 1,
        shippingAddressId: input.shippingAddressId,
        billingSameAsShipping: input.billingSameAsShipping ?? true,
        billingAddressId:
          input.billingSameAsShipping === false
            ? (input.billingAddressId ?? null)
            : null,
        shippingMethodId: input.shippingMethodId ?? null,
        shippingMethodCode: input.shippingMethodCode?.trim() ?? null,
        couponCode: input.couponCode?.trim().toUpperCase() ?? null,
        paymentMethod: input.paymentMethod,
        paymentProvider: input.paymentProvider ?? PaymentProvider.NONE,
      }),
    )
    .digest('hex');
}

// Preserve the existing header helper while sharing validation with service callers.
export const getIdempotencyKey = (req: Request): string =>
  validateIdempotencyKey(req.header('Idempotency-Key') ?? '');
