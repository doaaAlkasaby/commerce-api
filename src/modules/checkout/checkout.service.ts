import {
  Prisma,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

import {
  calculateEffectivePrice,
  toCents,
  centsToString,
} from '../../common/pricing/pricing.service.js';

import type { DiscountInput } from '../../common/pricing/pricing.types.js';

import { hashToken } from '../../common/security/token.js';

import { prisma } from '../../config/database.js';

import { checkoutRepository } from './checkout.repository.instance.js';

import { mapCheckoutOrder, mapCheckoutPayment } from './checkout.mapper.js';

import type {
  CheckoutContext,
  CheckoutInput,
  CheckoutResult,
} from './checkout.types.js';

const DEFAULT_CURRENCY = 'USD';

const ZERO = 0n;

/**
 * Generate a customer-facing order number.
 *
 * Example:
 * ORD-20261015-482913
 */
const generateOrderNumber = (): string => {
  const now = new Date();

  const year = now.getUTCFullYear().toString();

  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');

  const day = now.getUTCDate().toString().padStart(2, '0');

  const random = Math.floor(100000 + Math.random() * 900000);

  return `ORD-${year}${month}${day}-${random}`;
};

const normalizeCurrency = (currency?: string): string => {
  return (currency ?? DEFAULT_CURRENCY).toUpperCase();
};

const normalizeCouponCode = (code?: string): string | null => {
  if (!code) {
    return null;
  }

  const normalized = code.trim().toUpperCase();

  return normalized || null;
};

const toJsonRecord = (value: unknown): Record<string, unknown> => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
};

export class CheckoutService {
  /**
   * Main checkout operation.
   */
  async checkout(
    input: CheckoutInput,
    context: CheckoutContext,
  ): Promise<CheckoutResult> {
    /**
     * ----------------------------------------------------
     * 1. IDEMPOTENCY CHECK
     * ----------------------------------------------------
     */
    const existing = await checkoutRepository.findByIdempotencyKey(
      context.userId,
      context.idempotencyKey,
    );

    if (existing?.order) {
      const order = existing.order;

      const payment = order.payments[0] ?? null;

      return {
        order: mapCheckoutOrder(order),
        payment: payment ? mapCheckoutPayment(payment) : null,
        idempotent: true,
      };
    }

    /**
     * ----------------------------------------------------
     * 2. NORMALIZE INPUT
     * ----------------------------------------------------
     */
    const currency = normalizeCurrency(input.currency);

    const couponCode = normalizeCouponCode(input.couponCode);

    /**
     * ----------------------------------------------------
     * 3. LOAD CART + CREATE ORDER
     *
     * Everything affecting inventory/pricing/order
     * consistency happens inside one transaction.
     *
     * External payment providers MUST NOT be called
     * inside this transaction.
     * ----------------------------------------------------
     */
    const result = await prisma.$transaction(async (tx) => {
      /**
       * ------------------------------------------------
       * 3.1 Load cart
       * ------------------------------------------------
       */
      const cart = await tx.cart.findUnique({
        where: {
          userId: context.userId,
        },
        include: {
          items: {
            include: {
              variant: {
                include: {
                  product: {
                    include: {
                      category: true,
                    },
                  },
                  inventory: true,
                  values: {
                    include: {
                      attributeValue: {
                        include: {
                          attribute: true,
                        },
                      },
                    },
                  },
                  images: true,
                },
              },
            },
          },
        },
      });

      if (!cart) {
        throw new AppError('Cart not found', 404, 'CART_NOT_FOUND');
      }

      if (cart.items.length === 0) {
        throw new AppError('Cart is empty', 400, 'CART_EMPTY');
      }

      /**
       * ------------------------------------------------
       * 3.2 Load shipping address
       * ------------------------------------------------
       */
      const shippingAddress = await tx.address.findFirst({
        where: {
          id: input.shippingAddressId,
          userId: context.userId,
        },
      });

      if (!shippingAddress) {
        throw new AppError(
          'Shipping address not found',
          404,
          'SHIPPING_ADDRESS_NOT_FOUND',
        );
      }

      /**
       * ------------------------------------------------
       * 3.3 Load billing address
       * ------------------------------------------------
       */
      let billingAddress = shippingAddress;

      if (input.billingSameAsShipping === false) {
        if (!input.billingAddressId) {
          throw new AppError(
            'Billing address is required',
            400,
            'BILLING_ADDRESS_REQUIRED',
          );
        }

        const address = await tx.address.findFirst({
          where: {
            id: input.billingAddressId,
            userId: context.userId,
          },
        });

        if (!address) {
          throw new AppError(
            'Billing address not found',
            404,
            'BILLING_ADDRESS_NOT_FOUND',
          );
        }

        billingAddress = address;
      }

      /**
       * ------------------------------------------------
       * 3.4 Calculate cart items
       * ------------------------------------------------
       */
      let subtotalCents = ZERO;

      const orderItems: Array<{
        productId: string;
        variantId: string;
        productName: string;
        sku: string;
        quantity: number;
        unitPrice: string;
        itemDiscountAmount: string;
        finalUnitPrice: string;
        totalPrice: string;
        variantSnapshot: Prisma.InputJsonValue;
      }> = [];

      for (const cartItem of cart.items) {
        const variant = cartItem.variant;

        /**
         * ----------------------------------------------
         * Product must exist and be active.
         * ----------------------------------------------
         */
        if (variant.product.status !== 'ACTIVE') {
          throw new AppError(
            `Product "${variant.product.name}" is not available`,
            409,
            'PRODUCT_NOT_AVAILABLE',
          );
        }

        /**
         * ----------------------------------------------
         * Variant must be active.
         * ----------------------------------------------
         */
        if (!variant.isActive) {
          throw new AppError(
            `Variant "${variant.sku}" is not available`,
            409,
            'VARIANT_NOT_AVAILABLE',
          );
        }

        /**
         * ----------------------------------------------
         * Inventory must exist.
         * ----------------------------------------------
         */
        if (!variant.inventory) {
          throw new AppError(
            `Inventory not found for variant "${variant.sku}"`,
            409,
            'INVENTORY_NOT_FOUND',
          );
        }

        /**
         * ----------------------------------------------
         * Check available inventory.
         *
         * IMPORTANT:
         *
         * Cart does not reserve inventory.
         *
         * We only validate availability here.
         * Actual reservation happens atomically
         * below.
         * ----------------------------------------------
         */
        const availableQuantity =
          variant.inventory.quantity - variant.inventory.reservedQuantity;

        if (availableQuantity < cartItem.quantity) {
          throw new AppError(
            `Insufficient inventory for "${variant.sku}"`,
            409,
            'INSUFFICIENT_INVENTORY',
          );
        }

        /**
         * ----------------------------------------------
         * CORRECT PRICING CALCULATION
         * ----------------------------------------------
         *
         * Variant price overrides product price.
         *
         * Example:
         *
         * product.price = 100.00
         * variant.price = 120.00
         *
         * basePrice = 120.00
         */
        const basePrice =
          variant.price?.toString() ?? variant.product.basePrice.toString();

        /**
         * Product-level discount.
         */
        const productDiscount: DiscountInput = {
          type: variant.product.discountType,

          value: variant.product.discountValue?.toString() ?? null,

          startsAt: variant.product.discountStartsAt,

          endsAt: variant.product.discountEndsAt,
        };

        /**
         * Variant-level discount.
         *
         * Variant discount has priority over
         * product discount when active.
         */
        const variantDiscount: DiscountInput = {
          type: variant.discountType,

          value: variant.discountValue?.toString() ?? null,

          startsAt: variant.discountStartsAt,

          endsAt: variant.discountEndsAt,
        };

        /**
         * Calculate the effective UNIT price.
         */
        const effectivePrice = calculateEffectivePrice(
          basePrice,
          productDiscount,
          variantDiscount,
        );

        /**
         * ----------------------------------------------
         * Convert effective prices to integer cents.
         *
         * This avoids floating-point money errors.
         * ----------------------------------------------
         */
        const unitPriceCents = toCents(effectivePrice.basePrice);

        const discountPerUnitCents = toCents(effectivePrice.discountAmount);

        const finalUnitPriceCents = toCents(effectivePrice.finalPrice);

        /**
         * ----------------------------------------------
         * IMPORTANT:
         *
         * discountAmount returned by pricing service
         * is PER UNIT.
         *
         * Therefore:
         *
         * itemDiscount =
         * discountPerUnit × quantity
         * ----------------------------------------------
         */
        const itemDiscountCents =
          discountPerUnitCents * BigInt(cartItem.quantity);

        /**
         * ----------------------------------------------
         * Total price for this order item.
         * ----------------------------------------------
         */
        const totalPriceCents = finalUnitPriceCents * BigInt(cartItem.quantity);

        /**
         * ----------------------------------------------
         * Add to order subtotal.
         * ----------------------------------------------
         */
        subtotalCents += totalPriceCents;

        /**
         * ----------------------------------------------
         * Create historical variant snapshot.
         *
         * This protects order history if the catalog
         * changes later.
         * ----------------------------------------------
         */
        const variantSnapshot = {
          sku: variant.sku,

          price:
            unitPriceCents >= ZERO ? centsToString(unitPriceCents) : '0.00',

          finalPrice: centsToString(finalUnitPriceCents),

          discountType: effectivePrice.discountType,

          discountValue: effectivePrice.discountValue,

          attributes: variant.values.map(({ attributeValue }) => ({
            id: attributeValue.attribute.id,

            name: attributeValue.attribute.name,

            value: attributeValue.value,
          })),

          images: variant.images.map((image) => ({
            id: image.id,
            url: image.url,
            isPrimary: image.isPrimary,
          })),
        };

        orderItems.push({
          productId: variant.product.id,

          variantId: variant.id,

          productName: variant.product.name,

          sku: variant.sku,

          quantity: cartItem.quantity,

          unitPrice: centsToString(unitPriceCents),

          itemDiscountAmount: centsToString(itemDiscountCents),

          finalUnitPrice: centsToString(finalUnitPriceCents),

          totalPrice: centsToString(totalPriceCents),

          variantSnapshot: variantSnapshot as Prisma.InputJsonValue,
        });
      }

      /**
       * ------------------------------------------------
       * 3.5 Validate coupon
       * ------------------------------------------------
       */
      let coupon: Awaited<ReturnType<typeof tx.coupon.findUnique>> | null =
        null;

      let couponDiscountCents = ZERO;

      if (couponCode) {
        coupon = await tx.coupon.findUnique({
          where: {
            code: couponCode,
          },
        });

        if (!coupon) {
          throw new AppError('Coupon not found', 404, 'COUPON_NOT_FOUND');
        }

        const now = new Date();

        if (!coupon.isActive) {
          throw new AppError('Coupon is inactive', 400, 'COUPON_INACTIVE');
        }

        if (coupon.startsAt && now < coupon.startsAt) {
          throw new AppError(
            'Coupon is not active yet',
            400,
            'COUPON_NOT_STARTED',
          );
        }

        if (coupon.endsAt && now > coupon.endsAt) {
          throw new AppError('Coupon has expired', 400, 'COUPON_EXPIRED');
        }

        if (
          coupon.usageLimit !== null &&
          coupon.usageCount >= coupon.usageLimit
        ) {
          throw new AppError(
            'Coupon usage limit reached',
            400,
            'COUPON_USAGE_LIMIT_REACHED',
          );
        }

        /**
         * Check minimum order amount
         * against subtotal AFTER product/variant
         * discounts but BEFORE coupon discount.
         */
        if (coupon.minimumOrderAmount) {
          const minimumCents = toCents(coupon.minimumOrderAmount.toString());

          if (subtotalCents < minimumCents) {
            throw new AppError(
              `Minimum order amount is ${coupon.minimumOrderAmount.toString()}`,
              400,
              'COUPON_MINIMUM_ORDER_AMOUNT',
            );
          }
        }

        /**
         * Per-user coupon usage.
         */
        if (coupon.perUserLimit !== null) {
          const usageCount = await tx.couponUsage.count({
            where: {
              couponId: coupon.id,
              userId: context.userId,
            },
          });

          if (usageCount >= coupon.perUserLimit) {
            throw new AppError(
              'You have reached the usage limit for this coupon',
              400,
              'COUPON_USER_USAGE_LIMIT',
            );
          }
        }

        /**
         * Calculate coupon discount.
         */
        const couponValueCents = toCents(coupon.discountValue.toString());

        if (coupon.discountType === 'FIXED_AMOUNT') {
          couponDiscountCents = couponValueCents;
        } else {
          /**
           * Convert percentage into basis points.
           *
           * Example:
           *
           * 10.00% = 1000 basis points
           */
          const value = coupon.discountValue.toString();

          const [whole = '0', fraction = ''] = value.split('.');

          const basisPoints =
            BigInt(whole) * 100n +
            BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');

          couponDiscountCents = (subtotalCents * basisPoints + 5000n) / 10000n;
        }

        /**
         * Coupon cannot discount more than
         * the subtotal.
         */
        if (couponDiscountCents > subtotalCents) {
          couponDiscountCents = subtotalCents;
        }

        /**
         * Maximum coupon discount.
         */
        if (coupon.maximumDiscountAmount) {
          const maximumDiscountCents = toCents(
            coupon.maximumDiscountAmount.toString(),
          );

          if (couponDiscountCents > maximumDiscountCents) {
            couponDiscountCents = maximumDiscountCents;
          }
        }
      }

      /**
       * ------------------------------------------------
       * 3.6 Shipping / tax
       *
       * Currently zero because the current schema
       * does not contain shipping/tax calculation
       * engines.
       * ------------------------------------------------
       */
      const shippingCents = ZERO;

      const taxCents = ZERO;

      /**
       * ------------------------------------------------
       * 3.7 Calculate final order total.
       *
       * total =
       *
       * subtotal
       * - coupon discount
       * + shipping
       * + tax
       * ------------------------------------------------
       */
      const totalCents =
        subtotalCents - couponDiscountCents + shippingCents + taxCents;

      if (totalCents < ZERO) {
        throw new AppError(
          'Invalid checkout total',
          500,
          'INVALID_CHECKOUT_TOTAL',
        );
      }

      /**
       * ------------------------------------------------
       * 3.8 Create order
       * ------------------------------------------------
       */
      const orderNumber = generateOrderNumber();

      const shippingSnapshot = {
        firstName: shippingAddress.firstName,
        lastName: shippingAddress.lastName,
        company: shippingAddress.company,
        addressLine1: shippingAddress.addressLine1,
        addressLine2: shippingAddress.addressLine2,
        city: shippingAddress.city,
        state: shippingAddress.state,
        postalCode: shippingAddress.postalCode,
        country: shippingAddress.country,
        phone: shippingAddress.phone,
      };

      const billingSnapshot = {
        firstName: billingAddress.firstName,
        lastName: billingAddress.lastName,
        company: billingAddress.company,
        addressLine1: billingAddress.addressLine1,
        addressLine2: billingAddress.addressLine2,
        city: billingAddress.city,
        state: billingAddress.state,
        postalCode: billingAddress.postalCode,
        country: billingAddress.country,
        phone: billingAddress.phone,
      };

      const order = await tx.order.create({
        data: {
          orderNumber,

          userId: context.userId,

          couponId: coupon?.id ?? null,

          status:
            input.paymentMethod === PaymentMethod.CASH_ON_DELIVERY
              ? OrderStatus.CONFIRMED
              : OrderStatus.PENDING,

          paymentStatus: PaymentStatus.PENDING,

          currency,

          subtotal: new Prisma.Decimal(centsToString(subtotalCents)),

          discountAmount: new Prisma.Decimal(
            centsToString(couponDiscountCents),
          ),

          shippingAmount: new Prisma.Decimal(centsToString(shippingCents)),

          taxAmount: new Prisma.Decimal(centsToString(taxCents)),

          totalAmount: new Prisma.Decimal(centsToString(totalCents)),

          shippingAddress: shippingSnapshot as Prisma.InputJsonValue,

          billingAddress: billingSnapshot as Prisma.InputJsonValue,

          items: {
            create: orderItems.map((item) => ({
              productId: item.productId,

              variantId: item.variantId,

              productName: item.productName,

              sku: item.sku,

              quantity: item.quantity,

              unitPrice: new Prisma.Decimal(item.unitPrice),

              itemDiscountAmount: new Prisma.Decimal(item.itemDiscountAmount),

              finalUnitPrice: new Prisma.Decimal(item.finalUnitPrice),

              totalPrice: new Prisma.Decimal(item.totalPrice),

              variantSnapshot: item.variantSnapshot,
            })),
          },
        },

        include: {
          items: true,
        },
      });

      /**
       * ------------------------------------------------
       * 3.9 Reserve inventory
       * ------------------------------------------------
       *
       * Atomic update:
       *
       * quantity >=
       * reservedQuantity + requested
       *
       * This prevents concurrent checkout requests
       * from overselling stock.
       * ------------------------------------------------
       */
      for (const cartItem of cart.items) {
        const updated = await tx.inventory.updateMany({
          where: {
            id: cartItem.variant.inventory!.id,

            quantity: {
              gte:
                cartItem.variant.inventory!.reservedQuantity +
                cartItem.quantity,
            },
          },

          data: {
            reservedQuantity: {
              increment: cartItem.quantity,
            },
          },
        });

        if (updated.count !== 1) {
          throw new AppError(
            `Insufficient inventory for "${cartItem.variant.sku}"`,
            409,
            'INSUFFICIENT_INVENTORY',
          );
        }

        /**
         * Inventory reservation transaction.
         */
        await tx.inventoryTransaction.create({
          data: {
            inventoryId: cartItem.variant.inventory!.id,

            type: 'RESERVATION',

            quantity: cartItem.quantity,

            referenceId: order.id,

            reason: 'Checkout inventory reservation',
          },
        });
      }

      /**
       * ------------------------------------------------
       * 3.10 Consume coupon
       * ------------------------------------------------
       */
      if (coupon) {
        const updatedCoupon = await tx.coupon.updateMany({
          where: {
            id: coupon.id,

            isActive: true,

            OR: [
              {
                usageLimit: null,
              },
              {
                usageCount: {
                  lt: coupon.usageLimit ?? Number.MAX_SAFE_INTEGER,
                },
              },
            ],
          },

          data: {
            usageCount: {
              increment: 1,
            },
          },
        });

        if (updatedCoupon.count !== 1) {
          throw new AppError(
            'Coupon usage limit reached',
            409,
            'COUPON_USAGE_LIMIT_REACHED',
          );
        }

        await tx.couponUsage.create({
          data: {
            couponId: coupon.id,

            userId: context.userId,

            orderId: order.id,
          },
        });
      }

      /**
       * ------------------------------------------------
       * 3.11 Create pending payment
       * ------------------------------------------------
       *
       * We do NOT call Stripe/Paymob/etc. here.
       *
       * External APIs must be called AFTER the
       * database transaction completes.
       * ------------------------------------------------
       */
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,

          provider:
            input.paymentProvider ??
            (input.paymentMethod === PaymentMethod.CASH_ON_DELIVERY
              ? PaymentProvider.NONE
              : PaymentProvider.NONE),

          method: input.paymentMethod,

          status: PaymentStatus.PENDING,

          amount: new Prisma.Decimal(centsToString(totalCents)),

          currency,

          metadata: {
            checkoutId: context.idempotencyKey,
          },
        },
      });

      /**
       * ------------------------------------------------
       * 3.12 Clear cart
       * ------------------------------------------------
       */
      await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
        },
      });

      /**
       * ------------------------------------------------
       * 3.13 Store idempotency request
       * ------------------------------------------------
       */
      await tx.checkoutRequest.create({
        data: {
          userId: context.userId,

          idempotencyKey: context.idempotencyKey,

          orderId: order.id,
        },
      });

      /**
       * Reload complete order.
       */
      const completeOrder = await tx.order.findUniqueOrThrow({
        where: {
          id: order.id,
        },

        include: {
          items: true,
        },
      });

      return {
        order: completeOrder,

        payment,
      };
    });

    /**
     * ----------------------------------------------------
     * 4. RETURN RESULT
     * ----------------------------------------------------
     */
    return {
      order: mapCheckoutOrder(result.order),

      payment: result.payment ? mapCheckoutPayment(result.payment) : null,

      idempotent: false,
    };
  }
}

export const checkoutService = new CheckoutService();
