import { env } from '../../config/env.js';
import {
  checkoutFingerprint,
  validateIdempotencyKey,
} from './checkout.idempotency.js';
import { couponRepository } from '../coupons/coupon.repository.instance.js';
import {
  isCurrencyCode,
  currencyPrecision,
} from '../../common/pricing/currency.js';
import {
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import type { Address, TaxTreatment } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';
import {
  calculateEffectivePrice,
  percentageToBasisPoints,
  calculateCouponPercentageDiscount,
  centsToString,
  toCents,
} from '../../common/pricing/pricing.service.js';
import type { DiscountInput } from '../../common/pricing/pricing.types.js';

import { checkoutRepository } from './checkout.repository.instance.js';
import { mapCheckoutOrder, mapCheckoutPayment } from './checkout.mapper.js';
import { InventoryRepository } from '../inventory/inventory.repository.js';

import { prisma } from '../../config/database.js';

import { TaxService } from '../../common/tax/tax.service.js';
import { TaxRepository } from '../../common/tax/tax.repository.js';
import { calculateTax } from '../../common/tax/tax.calculator.js';
import { allocateCouponDiscount } from '../../common/tax/tax.allocation.js';
import { ShippingService } from '../../common/shipping/shipping.service.js';
import { ShippingRepository } from '../../common/shipping/shipping.repository.js';

import type {
  CheckoutContext,
  CheckoutInput,
  CheckoutResult,
  CheckoutPreviewInput,
  CheckoutPreviewContext,
} from './checkout.types.js';

const DEFAULT_SCOPE_KEY = 'GLOBAL';
const ZERO = 0n;

interface CalculatedItem {
  productId: string;
  variantId: string;
  productName: string;
  sku: string;
  quantity: number;

  unitPriceCents: bigint;
  itemDiscountAmountCents: bigint;
  finalUnitPriceCents: bigint;
  totalPriceCents: bigint;

  variantSnapshot: Prisma.InputJsonObject;

  taxCategoryId: string;
  taxCategoryCode: string;
  taxRuleId: string;
  taxRateBasisPoints: bigint;
  taxTreatment: TaxTreatment;
  pricesIncludeTax: boolean;
  taxProfileSnapshot: Prisma.InputJsonObject;
  taxRuleSnapshot: Prisma.InputJsonObject;
  taxableAmountCents: bigint;
  taxAmountCents: bigint;
}

export type CheckoutFailurePoint =
  | 'after-order-created'
  | 'after-inventory-reserved'
  | 'after-coupon-consumed'
  | 'before-payment-create';

export class CheckoutService {
  constructor(
    private readonly failureInjector?: (point: CheckoutFailurePoint) => void,
  ) {}

  private injectFailure(point: CheckoutFailurePoint): void {
    this.failureInjector?.(point);
  }

  async checkout(
    input: CheckoutInput,
    context: CheckoutContext,
  ): Promise<CheckoutResult> {
    const { tenantId, userId } = context;
    const idempotencyKey = validateIdempotencyKey(context.idempotencyKey);
    input = {
      ...input,
      billingSameAsShipping: input.billingSameAsShipping ?? true,
    };
    const requestFingerprint = checkoutFingerprint(input);
    // Preserve checkout's preflight coupon validation before replay/lock handling.
    if (input.couponCode)
      input = {
        ...input,
        couponCode: this.normalizeCouponCode(input.couponCode),
      };

    /*
     * ---------------------------------------------------------
     * 2. NORMALIZE INPUT
     * ---------------------------------------------------------
     */

    const paymentProvider =
      input.paymentProvider ??
      (input.paymentMethod === PaymentMethod.CARD &&
      env.PAYMENT_PROVIDER === 'MYFATOORAH'
        ? PaymentProvider.MYFATOORAH
        : PaymentProvider.NONE);

    /*
     * ---------------------------------------------------------
     * 3. TRANSACTION
     * ---------------------------------------------------------
     */

    const result = await prisma.$transaction(async (tx) => {
      // Scoped transaction lock precedes coupon, order and inventory locks.
      // No durable claim survives a rollback; another instance may safely retry.
      if (
        !(await checkoutRepository.tryLockRequest(
          tx,
          tenantId,
          userId,
          idempotencyKey,
        ))
      ) {
        throw new AppError(
          'Checkout is processing; retry with the same key and input',
          409,
          'CHECKOUT_IN_PROGRESS',
        );
      }
      const existingRequest = await checkoutRepository.findByIdempotencyKey(
        tx,
        tenantId,
        userId,
        idempotencyKey,
      );
      if (existingRequest) {
        if (!existingRequest.requestFingerprint) {
          throw new AppError(
            'Legacy checkout intent cannot be verified; use a new key for a new attempt',
            409,
            'IDEMPOTENCY_LEGACY_REQUEST',
          );
        }
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new AppError(
            'Idempotency key was already used for a different checkout intent',
            409,
            'IDEMPOTENCY_KEY_CONFLICT',
          );
        }
        if (
          !existingRequest.order ||
          existingRequest.order.tenantId !== tenantId ||
          existingRequest.order.userId !== userId
        ) {
          throw new AppError(
            'Original checkout result is unavailable',
            409,
            'CHECKOUT_RESULT_UNAVAILABLE',
          );
        }
        return {
          order: existingRequest.order,
          payment: existingRequest.order.payments[0] ?? null,
          idempotent: true,
        };
      }

      const {
        currency,
        cart,
        shippingAddress,
        billingAddress,
        discountedTaxableItems,
        subtotalCents,
        coupon,
        couponDiscountCents,
        shippingResult,
        shippingCents,
        taxCents,
        totalCents,
        taxCalculationTime,
      } = await this.calculateCheckout(tx, input, { tenantId, userId }, true);

      /*
       * -----------------------------------------------------
       * 3.10 ORDER NUMBER
       * -----------------------------------------------------
       */

      const orderNumber = await this.generateUniqueOrderNumber(tx, tenantId);

      /*
       * -----------------------------------------------------
       * 3.11 ORDER STATUS
       * -----------------------------------------------------
       */

      const orderStatus =
        input.paymentMethod === PaymentMethod.CASH_ON_DELIVERY
          ? OrderStatus.CONFIRMED
          : OrderStatus.PENDING;

      /*
       * -----------------------------------------------------
       * 3.12 CREATE ORDER
       * -----------------------------------------------------
       */

      const reservationExpiresAt = [
        PaymentMethod.CARD,
        PaymentMethod.DIGITAL_WALLET,
      ].some((method) => method === input.paymentMethod)
        ? await checkoutRepository.reservationDeadline(
            tx,
            env.RESERVATION_TTL_SECONDS,
          )
        : null;
      const order = await tx.order.create({
        data: {
          tenantId,
          orderNumber,
          reservationExpiresAt,
          userId,
          couponId: coupon?.id ?? null,
          couponSnapshot: coupon
            ? {
                id: coupon.id,
                code: coupon.code,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue.toString(),
                minimumOrderAmount:
                  coupon.minimumOrderAmount?.toString() ?? null,
                maximumDiscountAmount:
                  coupon.maximumDiscountAmount?.toString() ?? null,
                discountAmount: centsToString(couponDiscountCents, currency),
                currency,
              }
            : Prisma.DbNull,

          status: orderStatus,

          paymentStatus: PaymentStatus.PENDING,

          currency,

          subtotal: new Prisma.Decimal(centsToString(subtotalCents, currency)),

          discountAmount: new Prisma.Decimal(
            centsToString(couponDiscountCents, currency),
          ),

          shippingAmount: new Prisma.Decimal(
            centsToString(shippingCents, currency),
          ),

          taxAmount: new Prisma.Decimal(centsToString(taxCents, currency)),

          totalAmount: new Prisma.Decimal(centsToString(totalCents, currency)),

          /*
           * Tax configuration snapshot.
           */
          taxCountryCode: shippingAddress.countryCode,

          taxRegionCode: shippingAddress.state,

          shippingMethodId: shippingResult.shippingMethodId,
          shippingMethodCode: shippingResult.shippingMethodCode,
          shippingMethodName: shippingResult.shippingMethodName,
          shippingRuleId: shippingResult.shippingRuleId,
          shippingDistanceKm:
            shippingResult.distanceKm === null
              ? null
              : new Prisma.Decimal(shippingResult.distanceKm.toFixed(2)),

          shippingProfileSnapshot: {
            currency: shippingResult.currency,
            shippingMethodId: shippingResult.shippingMethodId,
            shippingMethodCode: shippingResult.shippingMethodCode,
            shippingMethodName: shippingResult.shippingMethodName,
            shippingRuleId: shippingResult.shippingRuleId,
            amount: centsToString(shippingCents, currency),
            distanceKm: shippingResult.distanceKm,
            eligibleSubtotal: centsToString(
              shippingResult.orderSubtotalCents,
              currency,
            ),
            minOrderAmount:
              shippingResult.minOrderAmountCents === null
                ? null
                : centsToString(shippingResult.minOrderAmountCents, currency),
            maxOrderAmount:
              shippingResult.maxOrderAmountCents === null
                ? null
                : centsToString(shippingResult.maxOrderAmountCents, currency),
            maxDistanceKm: shippingResult.maxDistanceKm,
          },

          pricesIncludeTax: discountedTaxableItems[0]!.pricesIncludeTax,

          taxProfileSnapshot: {
            ...discountedTaxableItems[0]!.taxProfileSnapshot,
            rules: Array.from(
              new Map(
                discountedTaxableItems.map((item) => [
                  item.taxRuleId,
                  item.taxRuleSnapshot,
                ]),
              ).values(),
            ),
            roundingPolicy: 'HALF_UP_PER_LINE',
            couponAllocation: 'PROPORTIONAL_LARGEST_REMAINDER_BY_VARIANT_ID',
            calculatedAt: taxCalculationTime.toISOString(),
            currency,
            pricesIncludeTax: discountedTaxableItems[0]!.pricesIncludeTax,
            tenantId,
            countryCode: shippingAddress.countryCode,
            regionCode: shippingAddress.state,
          },

          /*
           * Address snapshots.
           */
          shippingAddress: this.addressToSnapshot(shippingAddress),

          billingAddress: this.addressToSnapshot(billingAddress),

          items: {
            create: discountedTaxableItems.map((item) => ({
              productId: item.productId,

              variantId: item.variantId,

              productName: item.productName,

              sku: item.sku,

              quantity: item.quantity,

              unitPrice: new Prisma.Decimal(
                centsToString(item.unitPriceCents, currency),
              ),

              itemDiscountAmount: new Prisma.Decimal(
                centsToString(item.itemDiscountAmountCents, currency),
              ),

              finalUnitPrice: new Prisma.Decimal(
                centsToString(item.finalUnitPriceCents, currency),
              ),

              totalPrice: new Prisma.Decimal(
                centsToString(item.totalPriceCents, currency),
              ),

              variantSnapshot: item.variantSnapshot,

              /*
               * Tax snapshot.
               */
              taxCategoryCode: item.taxCategoryCode,

              taxCategoryId: item.taxCategoryId,

              taxRuleId: item.taxRuleId,

              taxTreatment: item.taxTreatment,

              taxRate: new Prisma.Decimal(
                centsToString(item.taxRateBasisPoints),
              ),

              taxableAmount: new Prisma.Decimal(
                centsToString(item.taxableAmountCents, currency),
              ),

              taxAmount: new Prisma.Decimal(
                centsToString(item.taxAmountCents, currency),
              ),
            })),
          },
        },
        include: {
          items: true,
          payments: true,
        },
      });

      this.injectFailure('after-order-created');

      /*
       * -----------------------------------------------------
       * 3.13 RESERVE INVENTORY
       * -----------------------------------------------------
       */

      const inventoryRepository = new InventoryRepository(tx);

      // Every checkout acquires shared inventory rows in the same order, even
      // when different coupons or differently ordered carts are involved.
      for (const item of [...cart.items].sort((a, b) =>
        a.variantId.localeCompare(b.variantId),
      )) {
        const inventory = item.variant.inventory;

        if (!inventory) {
          throw new AppError(
            `Inventory not found for variant ${item.variantId}`,
            409,
            'INVENTORY_NOT_FOUND',
          );
        }

        const updatedRows = await inventoryRepository.reserve(
          tenantId,
          inventory.id,
          item.quantity,
        );

        if (updatedRows !== 1) {
          throw new AppError(
            `Insufficient stock for SKU "${item.variant.sku}"`,
            409,
            'INSUFFICIENT_STOCK',
          );
        }

        await inventoryRepository.createTransaction(tenantId, {
          inventoryId: inventory.id,
          type: 'RESERVATION',
          quantity: item.quantity,
          referenceId: order.id,
          reason: `Checkout reservation for order ${order.orderNumber}`,
        });
      }

      this.injectFailure('after-inventory-reserved');

      /*
       * -----------------------------------------------------
       * 3.14 CONSUME COUPON
       * -----------------------------------------------------
       */

      if (coupon) {
        /*
         * Increment usage count.
         */
        await tx.coupon.update({
          where: {
            id: coupon.id,
            tenantId,
          },
          data: {
            usageCount: {
              increment: 1,
            },
          },
        });

        /*
         * Record user usage.
         */
        const [usageCoupon, usageOrder] = await Promise.all([
          tx.coupon.findFirst({
            where: { id: coupon.id, tenantId },
            select: { id: true },
          }),
          tx.order.findFirst({
            where: { id: order.id, tenantId },
            select: { id: true },
          }),
        ]);
        if (!usageCoupon || !usageOrder) {
          throw new AppError(
            'Coupon usage does not belong to this tenant',
            404,
            'COUPON_NOT_FOUND',
          );
        }
        await tx.couponUsage.create({
          data: {
            couponId: coupon.id,

            userId,

            orderId: order.id,
          },
        });

        this.injectFailure('after-coupon-consumed');
      }

      /*
       * -----------------------------------------------------
       * 3.15 CREATE PAYMENT
       * -----------------------------------------------------
       */

      this.injectFailure('before-payment-create');

      const payment = await tx.payment.create({
        data: {
          orderId: order.id,

          provider: paymentProvider,

          method: input.paymentMethod,

          status: PaymentStatus.PENDING,
          initiationState: 'NOT_STARTED',

          amount: new Prisma.Decimal(centsToString(totalCents, currency)),

          currency,

          metadata: {
            shippingMethod: shippingResult.shippingMethodCode,

            shippingMethodName: shippingResult.shippingMethodName,

            shippingAmount: centsToString(shippingCents, currency),
          },
        },
      });

      /*
       * -----------------------------------------------------
       * 3.16 CLEAR CART
       * -----------------------------------------------------
       */

      await tx.cartItem.deleteMany({
        where: {
          cartId: cart.id,
        },
      });

      /*
       * -----------------------------------------------------
       * 3.17 CHECKOUT REQUEST
       * -----------------------------------------------------
       */

      await checkoutRepository.createRequest(tx, {
        tenantId,
        requestFingerprint,
        userId,
        idempotencyKey,
        orderId: order.id,
      });

      /*
       * -----------------------------------------------------
       * 3.18 RELOAD COMPLETE ORDER
       * -----------------------------------------------------
       */

      const completeOrder = await tx.order.findUniqueOrThrow({
        where: {
          id: order.id,
        },
        include: {
          items: true,
          payments: true,
        },
      });

      return {
        order: completeOrder,
        payment,
        idempotent: false,
      };
    });

    /*
     * ---------------------------------------------------------
     * 4. RESPONSE
     * ---------------------------------------------------------
     */

    return {
      order: mapCheckoutOrder(result.order),

      payment: result.payment ? mapCheckoutPayment(result.payment) : null,

      idempotent: result.idempotent,
    };
  }

  private async calculateCheckout(
    tx: Prisma.TransactionClient,
    input: CheckoutPreviewInput,
    context: CheckoutPreviewContext,
    lockCoupon: boolean,
  ) {
    const { tenantId, userId } = context;
    input = {
      ...input,
      billingSameAsShipping: input.billingSameAsShipping ?? true,
    };
    const couponCode = input.couponCode
      ? this.normalizeCouponCode(input.couponCode)
      : undefined;
    const shippingService = new ShippingService(new ShippingRepository(tx));
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { defaultCurrency: true },
    });

    if (!tenant) {
      throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
    }

    const currency = this.resolveTenantCurrency(tenant.defaultCurrency);
    const taxService = new TaxService(new TaxRepository(tx), true);
    const taxCalculationTime = new Date();

    /*
     * -----------------------------------------------------
     * 3.1 LOAD CART
     * -----------------------------------------------------
     */

    const cart = await tx.cart.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      include: {
        items: {
          orderBy: { variantId: 'asc' },
          include: {
            variant: {
              include: {
                product: {
                  include: {
                    category: true,
                    images: { orderBy: { sortOrder: 'asc' } },
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
                images: {
                  orderBy: {
                    sortOrder: 'asc',
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new AppError('Cart is empty', 400, 'CART_EMPTY');
    }

    if (cart.items.some((item) => item.variant.product.tenantId !== tenantId)) {
      throw new AppError(
        'Cart contains an item outside this tenant',
        409,
        'CART_TENANT_MISMATCH',
      );
    }

    /*
     * -----------------------------------------------------
     * 3.2 SHIPPING ADDRESS
     * -----------------------------------------------------
     */

    const shippingAddress = await tx.address.findFirst({
      where: {
        id: input.shippingAddressId,
        userId,
      },
    });

    if (!shippingAddress) {
      throw new AppError(
        'Shipping address not found',
        404,
        'SHIPPING_ADDRESS_NOT_FOUND',
      );
    }

    /*
     * -----------------------------------------------------
     * 3.3 BILLING ADDRESS
     * -----------------------------------------------------
     */

    let billingAddress = shippingAddress;

    if (!input.billingSameAsShipping) {
      if (!input.billingAddressId) {
        throw new AppError(
          'Billing address is required',
          400,
          'BILLING_ADDRESS_REQUIRED',
        );
      }

      const foundBillingAddress = await tx.address.findFirst({
        where: {
          id: input.billingAddressId,
          userId,
        },
      });

      if (!foundBillingAddress) {
        throw new AppError(
          'Billing address not found',
          404,
          'BILLING_ADDRESS_NOT_FOUND',
        );
      }

      billingAddress = foundBillingAddress;
    }

    /*
     * -----------------------------------------------------
     * 3.4 CALCULATE CART PRICES
     * -----------------------------------------------------
     */

    const calculatedItems: CalculatedItem[] = [];

    let subtotalCents = ZERO;

    for (const cartItem of cart.items) {
      const variant = cartItem.variant;
      const product = variant.product;
      const inventory = variant.inventory;

      /*
       * Product must be active.
       */
      if (product.status !== 'ACTIVE') {
        throw new AppError(
          `Product "${product.name}" is not available`,
          409,
          'PRODUCT_NOT_AVAILABLE',
        );
      }

      /*
       * Variant must be active.
       */
      if (!variant.isActive) {
        throw new AppError(
          `Product variant "${variant.sku}" is not available`,
          409,
          'VARIANT_NOT_AVAILABLE',
        );
      }

      /*
       * Inventory must exist.
       */
      if (!inventory) {
        throw new AppError(
          `Inventory is not configured for SKU "${variant.sku}"`,
          409,
          'INVENTORY_NOT_CONFIGURED',
        );
      }

      /*
       * Available quantity.
       */
      const availableQuantity = inventory.quantity - inventory.reservedQuantity;

      if (availableQuantity < cartItem.quantity) {
        throw new AppError(
          `Insufficient stock for SKU "${variant.sku}"`,
          409,
          'INSUFFICIENT_STOCK',
        );
      }

      /*
       * Variant price overrides product price.
       */
      const basePrice = variant.price ?? product.basePrice;

      /*
       * Pricing service determines:
       *
       * - effective price
       * - active discount
       * - final price
       */
      const productDiscount: DiscountInput = {
        type: product.discountType,
        value: product.discountValue?.toString() ?? null,
        startsAt: product.discountStartsAt,
        endsAt: product.discountEndsAt,
      };
      const variantDiscount: DiscountInput = {
        type: variant.discountType,
        value: variant.discountValue?.toString() ?? null,
        startsAt: variant.discountStartsAt,
        endsAt: variant.discountEndsAt,
      };

      const pricing = calculateEffectivePrice(
        basePrice.toString(),
        productDiscount,
        variantDiscount,
        new Date(),
        currency,
      );

      const unitPriceCents = toCents(basePrice.toString(), currency);

      const finalUnitPriceCents = toCents(pricing.finalPrice, currency);

      const itemDiscountAmountCents = toCents(pricing.discountAmount, currency);

      const totalPriceCents = finalUnitPriceCents * BigInt(cartItem.quantity);

      /*
       * ---------------------------------------------------
       * TAX
       * ---------------------------------------------------
       *
       * Tax category resolution:
       *
       * Variant category
       *      ↓
       * Product category
       *      ↓
       * Global default category
       */

      const taxResult = await taxService.calculateForAmount({
        tenantId,
        currency,
        amountCents: totalPriceCents,
        now: taxCalculationTime,
        scopeKey: DEFAULT_SCOPE_KEY,
        address: {
          countryCode: shippingAddress.countryCode,
          regionCode: shippingAddress.state,
        },
        category: {
          variantTaxCategoryId: variant.taxCategoryId,
          productTaxCategoryId: product.taxCategoryId,
        },
      });

      subtotalCents += totalPriceCents;

      /*
       * Variant snapshot is stored permanently on the order.
       */
      const variantSnapshot: Prisma.InputJsonObject = {
        variantId: variant.id,
        sku: variant.sku,
        price: variant.price?.toString() ?? null,
        productId: product.id,
        productName: product.name,
        values: variant.values.map((variantValue) => ({
          id: variantValue.attributeValueId,
          value: variantValue.attributeValue.value,
          attributeId: variantValue.attributeValue.attributeId,
          attributeName: variantValue.attributeValue.attribute.name,
          imageUrl: variantValue.attributeValue.imageUrl,
        })),
        images: (variant.images.length ? variant.images : product.images).map(
          (image) => ({
            id: image.id,
            url: image.url,
            altText: image.altText,
            sortOrder: image.sortOrder,
            isPrimary: image.isPrimary,
          }),
        ),
      };

      calculatedItems.push({
        productId: product.id,
        variantId: variant.id,
        productName: product.name,
        sku: variant.sku,
        quantity: cartItem.quantity,

        unitPriceCents,
        itemDiscountAmountCents,
        finalUnitPriceCents,
        totalPriceCents,

        variantSnapshot,

        taxCategoryId: taxResult.taxCategoryId,
        taxCategoryCode: taxResult.taxCategoryCode,
        taxRuleId: taxResult.taxRuleId,
        taxRateBasisPoints: taxResult.rateBasisPoints,
        taxTreatment: taxResult.treatment,
        pricesIncludeTax: taxResult.pricesIncludeTax,
        taxProfileSnapshot: taxResult.profileSnapshot,
        taxRuleSnapshot: taxResult.ruleSnapshot,
        taxableAmountCents: taxResult.taxableAmountCents,
        taxAmountCents: taxResult.taxAmountCents,
      });
    }

    /*
     * -----------------------------------------------------
     * 3.5 COUPON
     * -----------------------------------------------------
     */

    let coupon = null;

    let couponDiscountCents = ZERO;

    if (couponCode) {
      // Lock before all eligibility checks, order creation, and inventory locks.
      // Global/per-user usage and coupon terms remain protected until commit.
      coupon = lockCoupon
        ? await couponRepository.findByCodeForUpdate(tx, tenantId, couponCode)
        : await couponRepository.findByCodeWithClient(tx, tenantId, couponCode);

      if (!coupon) {
        throw new AppError('Coupon not found', 400, 'COUPON_NOT_FOUND');
      }

      if (!coupon.isActive) {
        throw new AppError('Coupon is inactive', 400, 'COUPON_INACTIVE');
      }

      const now = new Date();

      if (coupon.startsAt && coupon.startsAt > now) {
        throw new AppError(
          'Coupon is not active yet',
          400,
          'COUPON_NOT_STARTED',
        );
      }

      if (coupon.endsAt && coupon.endsAt < now) {
        throw new AppError('Coupon has expired', 400, 'COUPON_EXPIRED');
      }

      if (
        coupon.usageLimit !== null &&
        coupon.usageCount >= coupon.usageLimit
      ) {
        throw new AppError(
          'Coupon usage limit has been reached',
          400,
          'COUPON_USAGE_LIMIT_REACHED',
        );
      }

      /*
       * Minimum order amount.
       */
      if (coupon.minimumOrderAmount !== null) {
        const minimumOrderCents = toCents(
          coupon.minimumOrderAmount.toString(),
          currency,
        );

        if (subtotalCents < minimumOrderCents) {
          throw new AppError(
            'Order does not meet the minimum amount required for this coupon',
            400,
            'COUPON_MINIMUM_ORDER_NOT_MET',
          );
        }
      }

      /*
       * Per-user usage.
       */
      if (coupon.perUserLimit !== null) {
        const userUsageCount = await tx.couponUsage.count({
          where: {
            couponId: coupon.id,
            userId,
            coupon: { tenantId },
            order: { tenantId },
          },
        });

        if (userUsageCount >= coupon.perUserLimit) {
          throw new AppError(
            'You have reached the usage limit for this coupon',
            400,
            'COUPON_USER_USAGE_LIMIT_REACHED',
          );
        }
      }

      /*
       * Calculate discount.
       */
      const discountValueCents =
        coupon.discountType === 'PERCENTAGE'
          ? percentageToBasisPoints(coupon.discountValue.toString())
          : toCents(coupon.discountValue.toString(), currency);

      if (coupon.discountType === 'PERCENTAGE') {
        /*
         * discountValue is percentage.
         *
         * Example:
         *
         * subtotal = 10000 cents
         * discount = 10%
         *
         * result = 1000 cents
         */

        couponDiscountCents = this.calculatePercentageDiscount(
          subtotalCents,
          discountValueCents,
        );
      } else {
        couponDiscountCents = discountValueCents;
      }

      /*
       * Maximum discount.
       */
      if (coupon.maximumDiscountAmount !== null) {
        const maximumDiscountCents = toCents(
          coupon.maximumDiscountAmount.toString(),
          currency,
        );

        if (couponDiscountCents > maximumDiscountCents) {
          couponDiscountCents = maximumDiscountCents;
        }
      }

      /*
       * Never allow discount greater than subtotal.
       */
      if (couponDiscountCents > subtotalCents) {
        couponDiscountCents = subtotalCents;
      }
    }

    /*
     * -----------------------------------------------------
     * 3.6 TAX AFTER COUPON
     * -----------------------------------------------------
     *
     * The previous item-level tax calculation was based
     * on item totals before the order-level coupon.
     *
     * For production checkout we recalculate tax after
     * allocating the coupon proportionally across items.
     */

    const discountedTaxableItems = await this.recalculateTaxesAfterCoupon({
      tenantId,
      currency,
      items: calculatedItems,
      couponDiscountCents,
      shippingAddress,
    });

    /*
     * -----------------------------------------------------
     * 3.7 SHIPPING
     * -----------------------------------------------------
     */

    // Shipping minimums use discounted merchandise after coupons, before tax
    // and shipping. Keep this derived from the canonical checkout amounts.
    const shippingEligibleSubtotalCents = subtotalCents - couponDiscountCents;

    const shippingResult = await shippingService.calculate({
      tenantId,
      scopeKey: DEFAULT_SCOPE_KEY,
      currency,
      orderSubtotalCents: shippingEligibleSubtotalCents,
      destination: {
        countryCode: shippingAddress.countryCode,
        regionCode: shippingAddress.state,
        city: shippingAddress.city,
        latitude:
          shippingAddress.latitude === null
            ? null
            : Number(shippingAddress.latitude),
        longitude:
          shippingAddress.longitude === null
            ? null
            : Number(shippingAddress.longitude),
      },
      ...(input.shippingMethodCode !== undefined
        ? { methodCode: input.shippingMethodCode }
        : {}),
    });

    const shippingCents = shippingResult.amountCents;

    /*
     * -----------------------------------------------------
     * 3.8 TOTAL TAX
     * -----------------------------------------------------
     */

    const taxCents = discountedTaxableItems.reduce(
      (sum, item) => sum + item.taxAmountCents,
      ZERO,
    );

    /*
     * -----------------------------------------------------
     * 3.9 TOTAL
     * -----------------------------------------------------
     */

    // Included tax is already in merchandise prices; add only exclusive tax.
    const totalCents =
      subtotalCents -
      couponDiscountCents +
      shippingCents +
      discountedTaxableItems.reduce(
        (sum, item) =>
          sum + (item.pricesIncludeTax ? ZERO : item.taxAmountCents),
        ZERO,
      );

    // Reject a tax/quantity
    // overflow before order creation rather than leaking a database error.
    const maxPersistedCents = toCents(
      '9999999999' +
        (currencyPrecision(currency)
          ? '.' + '9'.repeat(currencyPrecision(currency))
          : ''),
      currency,
    );
    const persistedAmounts = [
      subtotalCents,
      couponDiscountCents,
      shippingCents,
      taxCents,
      totalCents,
      ...discountedTaxableItems.flatMap((item) => [
        item.unitPriceCents,
        item.itemDiscountAmountCents,
        item.finalUnitPriceCents,
        item.totalPriceCents,
        item.taxableAmountCents,
        item.taxAmountCents,
      ]),
    ];
    if (persistedAmounts.some((amount) => amount > maxPersistedCents))
      throw new AppError(
        'Checkout amounts exceed supported monetary precision',
        400,
        'CHECKOUT_AMOUNT_OUT_OF_RANGE',
      );

    if (totalCents < ZERO) {
      throw new AppError('Invalid order total', 400, 'INVALID_ORDER_TOTAL');
    }

    return {
      currency,
      cart,
      shippingAddress,
      billingAddress,
      discountedTaxableItems,
      subtotalCents,
      coupon,
      couponDiscountCents,
      shippingResult,
      shippingCents,
      taxCents,
      totalCents,
      taxCalculationTime,
    };
  }

  async preview(input: CheckoutPreviewInput, context: CheckoutPreviewContext) {
    return prisma.$transaction(
      async (tx) => {
        // Enforced by PostgreSQL, not merely by avoiding write calls in this method.
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const calculated = await this.calculateCheckout(
          tx,
          input,
          context,
          false,
        );
        const money = (cents: bigint) =>
          new Prisma.Decimal(centsToString(cents, currency)).toString();
        const {
          currency,
          discountedTaxableItems: items,
          shippingResult,
          coupon,
        } = calculated;
        return {
          estimated: true,
          currency,
          items: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName,
            sku: item.sku,
            quantity: item.quantity,
            currency,
            unitPrice: money(item.unitPriceCents),
            itemDiscountAmount: money(item.itemDiscountAmountCents),
            finalUnitPrice: money(item.finalUnitPriceCents),
            totalPrice: money(item.totalPriceCents),
            couponDiscount: money(
              item.totalPriceCents -
                item.taxableAmountCents -
                (item.pricesIncludeTax ? item.taxAmountCents : ZERO),
            ),
          })),
          subtotal: money(calculated.subtotalCents),
          productDiscount: money(
            items.reduce(
              (sum, item) =>
                sum + item.itemDiscountAmountCents * BigInt(item.quantity),
              ZERO,
            ),
          ),
          couponDiscount: money(calculated.couponDiscountCents),
          shippingAmount: money(calculated.shippingCents),
          taxAmount: money(calculated.taxCents),
          totalAmount: money(calculated.totalCents),
          pricesIncludeTax: items[0]!.pricesIncludeTax,
          shipping: {
            methodCode: shippingResult.shippingMethodCode,
            methodName: shippingResult.shippingMethodName,
            currency,
            amount: money(calculated.shippingCents),
            distanceKm: shippingResult.distanceKm,
          },
          coupon: coupon
            ? {
                code: coupon.code,
                discountType: coupon.discountType,
                discountValue: coupon.discountValue.toString(),
                currency,
                discountAmount: money(calculated.couponDiscountCents),
              }
            : null,
          taxBreakdown: items.map((item) => ({
            variantId: item.variantId,
            currency,
            taxCategoryCode: item.taxCategoryCode,
            taxTreatment: item.taxTreatment,
            taxRate: money(item.taxRateBasisPoints),
            pricesIncludeTax: item.pricesIncludeTax,
            taxableAmount: money(item.taxableAmountCents),
            taxAmount: money(item.taxAmountCents),
          })),
          warnings: [
            'This is an estimate. Prices, availability and eligibility may change before checkout. No stock or price is reserved.',
          ],
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /*
   * =========================================================
   * HELPERS
   * =========================================================
   */

  private resolveTenantCurrency(currency: string | null): string {
    if (!currency || !/^[A-Z]{3}$/.test(currency)) {
      throw new AppError(
        'Tenant default currency must be configured as an uppercase ISO 4217 code.',
        500,
        'TENANT_CURRENCY_NOT_CONFIGURED',
      );
    }

    if (!isCurrencyCode(currency)) {
      throw new AppError(
        'Tenant default currency is not a valid ISO 4217 code.',
        500,
        'TENANT_CURRENCY_INVALID',
      );
    }

    return currency;
  }

  private normalizeCouponCode(code: string): string {
    const normalized = code.trim().toUpperCase();

    if (normalized.length === 0) {
      throw new AppError(
        'Coupon code cannot be empty',
        400,
        'INVALID_COUPON_CODE',
      );
    }

    return normalized;
  }

  private calculatePercentageDiscount(
    amountCents: bigint,
    percentageCents: bigint,
  ): bigint {
    /*
     * percentageCents:
     *
     * 10% => 1000
     * 15.5% => 1550
     *
     * Because percentage has 2 decimal places,
     * divide by 10000.
     */

    return calculateCouponPercentageDiscount(amountCents, percentageCents);
  }

  private addressToSnapshot(address: Address): Prisma.InputJsonObject {
    return {
      id: address.id,
      label: address.label,
      firstName: address.firstName,
      lastName: address.lastName,
      company: address.company,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.countryCode,
      countryCode: address.countryCode,
      phone: address.phone,
      latitude: address.latitude?.toString() ?? null,
      longitude: address.longitude?.toString() ?? null,
    };
  }

  private async generateUniqueOrderNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const now = new Date();

      const year = now.getFullYear();

      const month = String(now.getMonth() + 1).padStart(2, '0');

      const day = String(now.getDate()).padStart(2, '0');

      const random = Math.floor(100000 + Math.random() * 900000);

      const orderNumber = `ORD-${year}${month}${day}-${random}`;

      const existing = await tx.order.findUnique({
        where: {
          tenantId_orderNumber: { tenantId, orderNumber },
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        return orderNumber;
      }
    }

    throw new AppError(
      'Could not generate a unique order number',
      500,
      'ORDER_NUMBER_GENERATION_FAILED',
    );
  }

  private async recalculateTaxesAfterCoupon(params: {
    tenantId: string;
    currency: string;
    items: CalculatedItem[];
    couponDiscountCents: bigint;
    shippingAddress: {
      countryCode: string;
      state: string | null;
    };
  }): Promise<CalculatedItem[]> {
    const { items, couponDiscountCents } = params;

    if (couponDiscountCents === ZERO) {
      return items;
    }

    const subtotalCents = items.reduce(
      (sum, item) => sum + item.totalPriceCents,
      ZERO,
    );

    if (subtotalCents === ZERO) {
      return items;
    }

    /*
     * Allocate coupon discount proportionally
     * across order items.
     */
    const discounts = allocateCouponDiscount(
      items.map((item) => ({
        key: item.variantId,
        amountCents: item.totalPriceCents,
      })),
      couponDiscountCents,
    );
    return items.map((item, index) => {
      const taxResult = calculateTax({
        amountCents: item.totalPriceCents - discounts[index]!,
        pricesIncludeTax: item.pricesIncludeTax,
        treatment: item.taxTreatment,
        rateBasisPoints: item.taxRateBasisPoints,
        taxCategoryId: item.taxCategoryId,
        taxCategoryCode: item.taxCategoryCode,
        taxRuleId: item.taxRuleId,
      });
      return {
        ...item,

        taxableAmountCents: taxResult.taxableAmountCents,

        taxAmountCents: taxResult.taxAmountCents,

        taxRateBasisPoints: taxResult.rateBasisPoints,

        taxTreatment: taxResult.treatment,
        pricesIncludeTax: taxResult.pricesIncludeTax,

        taxCategoryId: taxResult.taxCategoryId,

        taxCategoryCode: taxResult.taxCategoryCode,

        taxRuleId: taxResult.taxRuleId,
      };
    });
  }
}

export const checkoutService = new CheckoutService();
