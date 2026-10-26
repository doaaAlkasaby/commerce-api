import {
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app.error.js';
import {
  calculateEffectivePrice,
  centsToString,
  toCents,
} from '../../common/pricing/pricing.service.js';
import type { DiscountInput } from '../../common/pricing/pricing.types.js';

import { checkoutRepository } from './checkout.repository.instance.js';
import { mapCheckoutOrder, mapCheckoutPayment } from './checkout.mapper.js';

import { prisma } from '../../config/database.js';

import { taxService } from '../../common/tax/tax.service.instance.js';
import { shippingService } from '../../common/shipping/shipping.service.instance.js';

import type {
  CheckoutContext,
  CheckoutInput,
  CheckoutOrderItemResponse,
  CheckoutOrderResponse,
  CheckoutPaymentResponse,
  CheckoutResult,
} from './checkout.types.js';

const DEFAULT_CURRENCY = 'USD';
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

  variantSnapshot: Record<string, unknown>;

  taxCategoryId: string;
  taxCategoryCode: string;
  taxRuleId: string;
  taxRateBasisPoints: bigint;
  taxTreatment: string;
  taxableAmountCents: bigint;
  taxAmountCents: bigint;
}

interface CalculatedShipping {
  amountCents: bigint;
  methodId: string;
  methodCode: string;
  methodName: string;
  zoneId: string;
  zoneCode: string;
}

export class CheckoutService {
  async checkout(
    input: CheckoutInput,
    context: CheckoutContext,
  ): Promise<CheckoutResult> {
    const { userId, idempotencyKey } = context;

    /*
     * ---------------------------------------------------------
     * 1. IDEMPOTENCY CHECK
     * ---------------------------------------------------------
     */

    const existingRequest =
      await checkoutRepository.findByIdempotencyKey(
        userId,
        idempotencyKey,
      );

    if (existingRequest?.order) {
      const order = existingRequest.order;

      const payment =
        order.payments && order.payments.length > 0
          ? order.payments[0]
          : null;

      return {
        order: mapCheckoutOrder(order),
        payment: payment ? mapCheckoutPayment(payment) : null,
        idempotent: true,
      };
    }

    /*
     * ---------------------------------------------------------
     * 2. NORMALIZE INPUT
     * ---------------------------------------------------------
     */

    const currency = this.normalizeCurrency(input.currency);

    const couponCode = input.couponCode
      ? this.normalizeCouponCode(input.couponCode)
      : undefined;

    const paymentProvider =
      input.paymentProvider ?? PaymentProvider.NONE;

    /*
     * ---------------------------------------------------------
     * 3. TRANSACTION
     * ---------------------------------------------------------
     */

    const result = await prisma.$transaction(
      async (tx) => {
        /*
         * -----------------------------------------------------
         * 3.1 LOAD CART
         * -----------------------------------------------------
         */

        const cart = await tx.cart.findUnique({
          where: {
            userId,
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
                        attribute: true,
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
          throw new AppError(
            'Cart is empty',
            'CART_EMPTY',
            400,
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
            'SHIPPING_ADDRESS_NOT_FOUND',
            404,
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
              'BILLING_ADDRESS_REQUIRED',
              400,
            );
          }

          const foundBillingAddress =
            await tx.address.findFirst({
              where: {
                id: input.billingAddressId,
                userId,
              },
            });

          if (!foundBillingAddress) {
            throw new AppError(
              'Billing address not found',
              'BILLING_ADDRESS_NOT_FOUND',
              404,
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
              'PRODUCT_NOT_AVAILABLE',
              409,
            );
          }

          /*
           * Variant must be active.
           */
          if (!variant.isActive) {
            throw new AppError(
              `Product variant "${variant.sku}" is not available`,
              'VARIANT_NOT_AVAILABLE',
              409,
            );
          }

          /*
           * Inventory must exist.
           */
          if (!inventory) {
            throw new AppError(
              `Inventory is not configured for SKU "${variant.sku}"`,
              'INVENTORY_NOT_CONFIGURED',
              409,
            );
          }

          /*
           * Available quantity.
           */
          const availableQuantity =
            inventory.quantity - inventory.reservedQuantity;

          if (availableQuantity < cartItem.quantity) {
            throw new AppError(
              `Insufficient stock for SKU "${variant.sku}"`,
              'INSUFFICIENT_STOCK',
              409,
            );
          }

          /*
           * Variant price overrides product price.
           */
          const basePrice =
            variant.price ?? product.basePrice;

          /*
           * Pricing service determines:
           *
           * - effective price
           * - active discount
           * - final price
           */
          const discountInput: DiscountInput = {
            basePrice,
            productDiscountType: product.discountType,
            productDiscountValue: product.discountValue,
            productDiscountStartsAt:
              product.discountStartsAt,
            productDiscountEndsAt:
              product.discountEndsAt,
            variantDiscountType:
              variant.discountType,
            variantDiscountValue:
              variant.discountValue,
            variantDiscountStartsAt:
              variant.discountStartsAt,
            variantDiscountEndsAt:
              variant.discountEndsAt,
          };

          const pricing =
            calculateEffectivePrice(discountInput);

          const unitPriceCents = toCents(basePrice);

          const finalUnitPriceCents =
            pricing.finalPriceCents;

          const itemDiscountAmountCents =
            unitPriceCents - finalUnitPriceCents;

          const totalPriceCents =
            finalUnitPriceCents *
            BigInt(cartItem.quantity);

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

          const taxResult =
            await taxService.calculateForAmount({
              amountCents: totalPriceCents,
              scopeKey: DEFAULT_SCOPE_KEY,
              countryCode:
                shippingAddress.country,
              regionCode:
                shippingAddress.state,
              variantTaxCategoryId:
                variant.taxCategoryId,
              productTaxCategoryId:
                product.taxCategoryId,
            });

          subtotalCents += totalPriceCents;

          /*
           * Variant snapshot is stored permanently on the order.
           */
          const variantSnapshot: Record<
            string,
            unknown
          > = {
            variantId: variant.id,
            sku: variant.sku,
            price: variant.price?.toString() ?? null,
            productId: product.id,
            productName: product.name,
            values: variant.values.map((value) => ({
              id: value.id,
              value: value.value,
              attributeId: value.attributeId,
              attributeName: value.attribute.name,
            })),
            images: variant.images.map((image) => ({
              id: image.id,
              url: image.url,
              altText: image.altText,
              sortOrder: image.sortOrder,
              isPrimary: image.isPrimary,
            })),
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

            taxCategoryId:
              taxResult.taxCategoryId,
            taxCategoryCode:
              taxResult.taxCategoryCode,
            taxRuleId:
              taxResult.taxRuleId,
            taxRateBasisPoints:
              taxResult.rateBasisPoints,
            taxTreatment:
              taxResult.treatment,
            taxableAmountCents:
              taxResult.taxableAmountCents,
            taxAmountCents:
              taxResult.taxAmountCents,
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
          coupon = await tx.coupon.findUnique({
            where: {
              code: couponCode,
            },
          });

          if (!coupon) {
            throw new AppError(
              'Coupon not found',
              'COUPON_NOT_FOUND',
              400,
            );
          }

          if (!coupon.isActive) {
            throw new AppError(
              'Coupon is inactive',
              'COUPON_INACTIVE',
              400,
            );
          }

          const now = new Date();

          if (
            coupon.startsAt &&
            coupon.startsAt > now
          ) {
            throw new AppError(
              'Coupon is not active yet',
              'COUPON_NOT_STARTED',
              400,
            );
          }

          if (
            coupon.endsAt &&
            coupon.endsAt < now
          ) {
            throw new AppError(
              'Coupon has expired',
              'COUPON_EXPIRED',
              400,
            );
          }

          if (
            coupon.usageLimit !== null &&
            coupon.usageCount >= coupon.usageLimit
          ) {
            throw new AppError(
              'Coupon usage limit has been reached',
              'COUPON_USAGE_LIMIT_REACHED',
              400,
            );
          }

          /*
           * Minimum order amount.
           */
          if (
            coupon.minimumOrderAmount !== null
          ) {
            const minimumOrderCents =
              toCents(coupon.minimumOrderAmount);

            if (
              subtotalCents <
              minimumOrderCents
            ) {
              throw new AppError(
                'Order does not meet the minimum amount required for this coupon',
                'COUPON_MINIMUM_ORDER_NOT_MET',
                400,
              );
            }
          }

          /*
           * Per-user usage.
           */
          if (
            coupon.perUserLimit !== null
          ) {
            const userUsageCount =
              await tx.couponUsage.count({
                where: {
                  couponId: coupon.id,
                  userId,
                },
              });

            if (
              userUsageCount >=
              coupon.perUserLimit
            ) {
              throw new AppError(
                'You have reached the usage limit for this coupon',
                'COUPON_USER_USAGE_LIMIT_REACHED',
                400,
              );
            }
          }

          /*
           * Calculate discount.
           */
          const discountValueCents =
            toCents(coupon.discountValue);

          if (
            coupon.discountType ===
            'PERCENTAGE'
          ) {
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

            couponDiscountCents =
              this.calculatePercentageDiscount(
                subtotalCents,
                discountValueCents,
              );
          } else {
            couponDiscountCents =
              discountValueCents;
          }

          /*
           * Maximum discount.
           */
          if (
            coupon.maximumDiscountAmount !==
            null
          ) {
            const maximumDiscountCents =
              toCents(
                coupon.maximumDiscountAmount,
              );

            if (
              couponDiscountCents >
              maximumDiscountCents
            ) {
              couponDiscountCents =
                maximumDiscountCents;
            }
          }

          /*
           * Never allow discount greater than subtotal.
           */
          if (
            couponDiscountCents >
            subtotalCents
          ) {
            couponDiscountCents =
              subtotalCents;
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

        const discountedTaxableItems =
          await this.recalculateTaxesAfterCoupon({
            items: calculatedItems,
            couponDiscountCents,
            shippingAddress,
          });

        /*
         * -----------------------------------------------------
         * 3.7 SHIPPING
         * -----------------------------------------------------
         */

        const amountForShippingCents =
          subtotalCents -
          couponDiscountCents;

        const shippingResult =
          await shippingService.calculate({
            scopeKey: DEFAULT_SCOPE_KEY,
            currency,
            orderAmountCents:
              amountForShippingCents,
            address: {
              countryCode:
                shippingAddress.country,
              regionCode:
                shippingAddress.state,
              city:
                shippingAddress.city,
            },
            methodCode:
              input.shippingMethodCode,
          });

        const shippingCents =
          shippingResult.amountCents;

        /*
         * -----------------------------------------------------
         * 3.8 TOTAL TAX
         * -----------------------------------------------------
         */

        const taxCents =
          discountedTaxableItems.reduce(
            (sum, item) =>
              sum + item.taxAmountCents,
            ZERO,
          );

        /*
         * -----------------------------------------------------
         * 3.9 TOTAL
         * -----------------------------------------------------
         */

        const totalCents =
          subtotalCents -
          couponDiscountCents +
          shippingCents +
          taxCents;

        if (totalCents < ZERO) {
          throw new AppError(
            'Invalid order total',
            'INVALID_ORDER_TOTAL',
            400,
          );
        }

        /*
         * -----------------------------------------------------
         * 3.10 ORDER NUMBER
         * -----------------------------------------------------
         */

        const orderNumber =
          await this.generateUniqueOrderNumber(tx);

        /*
         * -----------------------------------------------------
         * 3.11 ORDER STATUS
         * -----------------------------------------------------
         */

        const orderStatus =
          input.paymentMethod ===
          PaymentMethod.CASH_ON_DELIVERY
            ? OrderStatus.CONFIRMED
            : OrderStatus.PENDING;

        /*
         * -----------------------------------------------------
         * 3.12 CREATE ORDER
         * -----------------------------------------------------
         */

        const order = await tx.order.create({
          data: {
            orderNumber,
            userId,
            couponId: coupon?.id ?? null,

            status: orderStatus,

            paymentStatus:
              PaymentStatus.PENDING,

            currency,

            subtotal:
              new Prisma.Decimal(
                centsToString(subtotalCents),
              ),

            discountAmount:
              new Prisma.Decimal(
                centsToString(
                  couponDiscountCents,
                ),
              ),

            shippingAmount:
              new Prisma.Decimal(
                centsToString(shippingCents),
              ),

            taxAmount:
              new Prisma.Decimal(
                centsToString(taxCents),
              ),

            totalAmount:
              new Prisma.Decimal(
                centsToString(totalCents),
              ),

            /*
             * Tax configuration snapshot.
             */
            taxCountryCode:
              shippingAddress.country,

            taxRegionCode:
              shippingAddress.state,

            pricesIncludeTax:
              false,

            taxProfileSnapshot: {
              scopeKey:
                DEFAULT_SCOPE_KEY,
              countryCode:
                shippingAddress.country,
              regionCode:
                shippingAddress.state,
            },

            /*
             * Address snapshots.
             */
            shippingAddress:
              this.addressToSnapshot(
                shippingAddress,
              ),

            billingAddress:
              this.addressToSnapshot(
                billingAddress,
              ),

            items: {
              create:
                discountedTaxableItems.map(
                  (item) => ({
                    productId:
                      item.productId,

                    variantId:
                      item.variantId,

                    productName:
                      item.productName,

                    sku:
                      item.sku,

                    quantity:
                      item.quantity,

                    unitPrice:
                      new Prisma.Decimal(
                        centsToString(
                          item.unitPriceCents,
                        ),
                      ),

                    itemDiscountAmount:
                      new Prisma.Decimal(
                        centsToString(
                          item.itemDiscountAmountCents,
                        ),
                      ),

                    finalUnitPrice:
                      new Prisma.Decimal(
                        centsToString(
                          item.finalUnitPriceCents,
                        ),
                      ),

                    totalPrice:
                      new Prisma.Decimal(
                        centsToString(
                          item.totalPriceCents,
                        ),
                      ),

                    variantSnapshot:
                      item.variantSnapshot,

                    /*
                     * Tax snapshot.
                     */
                    taxCategoryCode:
                      item.taxCategoryCode,

                    taxTreatment:
                      item.taxTreatment as any,

                    taxRate:
                      new Prisma.Decimal(
                        (
                          Number(
                            item.taxRateBasisPoints,
                          ) / 100
                        ).toFixed(2),
                      ),

                    taxableAmount:
                      new Prisma.Decimal(
                        centsToString(
                          item.taxableAmountCents,
                        ),
                      ),

                    taxAmount:
                      new Prisma.Decimal(
                        centsToString(
                          item.taxAmountCents,
                        ),
                      ),
                  }),
                ),
            },
          },
          include: {
            items: true,
            payments: true,
          },
        });

        /*
         * -----------------------------------------------------
         * 3.13 RESERVE INVENTORY
         * -----------------------------------------------------
         */

        for (const item of cart.items) {
          const inventory =
            await tx.inventory.findUnique({
              where: {
                variantId:
                  item.variantId,
              },
            });

          if (!inventory) {
            throw new AppError(
              `Inventory not found for variant ${item.variantId}`,
              'INVENTORY_NOT_FOUND',
              409,
            );
          }

          /*
           * Atomic reservation.
           *
           * This prevents two concurrent checkouts from
           * reserving the same stock.
           */
          const updatedInventory =
            await tx.inventory.updateMany({
              where: {
                id: inventory.id,
                quantity: {
                  gte:
                    inventory.reservedQuantity +
                    item.quantity,
                },
              },
              data: {
                reservedQuantity: {
                  increment:
                    item.quantity,
                },
              },
            });

          if (
            updatedInventory.count !== 1
          ) {
            throw new AppError(
              `Insufficient stock for SKU "${item.variant.sku}"`,
              'INSUFFICIENT_STOCK',
              409,
            );
          }

          await tx.inventoryTransaction.create({
            data: {
              inventoryId:
                inventory.id,

              type: 'RESERVATION',

              quantity:
                item.quantity,

              referenceId:
                order.id,

              reason:
                `Checkout reservation for order ${order.orderNumber}`,
            },
          });
        }

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
          await tx.couponUsage.create({
            data: {
              couponId:
                coupon.id,

              userId,

              orderId:
                order.id,
            },
          });
        }

        /*
         * -----------------------------------------------------
         * 3.15 CREATE PAYMENT
         * -----------------------------------------------------
         */

        const payment =
          await tx.payment.create({
            data: {
              orderId:
                order.id,

              provider:
                paymentProvider,

              method:
                input.paymentMethod,

              status:
                PaymentStatus.PENDING,

              amount:
                new Prisma.Decimal(
                  centsToString(
                    totalCents,
                  ),
                ),

              currency,

              metadata: {
                shippingMethod:
                  shippingResult.methodCode,

                shippingMethodName:
                  shippingResult.methodName,

                shippingZone:
                  shippingResult.zoneCode,

                shippingAmount:
                  centsToString(
                    shippingCents,
                  ),
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
            cartId:
              cart.id,
          },
        });

        /*
         * -----------------------------------------------------
         * 3.17 CHECKOUT REQUEST
         * -----------------------------------------------------
         */

        await checkoutRepository.createRequest(
          tx,
          {
            userId,
            idempotencyKey,
            orderId: order.id,
          },
        );

        /*
         * -----------------------------------------------------
         * 3.18 RELOAD COMPLETE ORDER
         * -----------------------------------------------------
         */

        const completeOrder =
          await tx.order.findUniqueOrThrow({
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
        };
      },
    );

    /*
     * ---------------------------------------------------------
     * 4. RESPONSE
     * ---------------------------------------------------------
     */

    return {
      order: mapCheckoutOrder(
        result.order,
      ),

      payment: result.payment
        ? mapCheckoutPayment(
            result.payment,
          )
        : null,

      idempotent: false,
    };
  }

  /*
   * =========================================================
   * HELPERS
   * =========================================================
   */

  private normalizeCurrency(
    currency?: string,
  ): string {
    const normalized =
      currency?.trim().toUpperCase() ??
      DEFAULT_CURRENCY;

    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new AppError(
        'Currency must be a valid 3-letter ISO currency code',
        'INVALID_CURRENCY',
        400,
      );
    }

    return normalized;
  }

  private normalizeCouponCode(
    code: string,
  ): string {
    const normalized =
      code.trim().toUpperCase();

    if (normalized.length === 0) {
      throw new AppError(
        'Coupon code cannot be empty',
        'INVALID_COUPON_CODE',
        400,
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

    return (
      amountCents *
      percentageCents /
      10000n
    );
  }

  private addressToSnapshot(
    address: {
      id: string;
      userId: string;
      label: string | null;
      firstName: string;
      lastName: string;
      company: string | null;
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string | null;
      postalCode: string | null;
      country: string;
      phone: string | null;
    },
  ): Record<string, unknown> {
    return {
      id: address.id,
      label: address.label,
      firstName:
        address.firstName,
      lastName:
        address.lastName,
      company:
        address.company,
      addressLine1:
        address.addressLine1,
      addressLine2:
        address.addressLine2,
      city:
        address.city,
      state:
        address.state,
      postalCode:
        address.postalCode,
      country:
        address.country,
      phone:
        address.phone,
    };
  }

  private async generateUniqueOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const now = new Date();

      const year =
        now.getFullYear();

      const month =
        String(
          now.getMonth() + 1,
        ).padStart(2, '0');

      const day =
        String(
          now.getDate(),
        ).padStart(2, '0');

      const random =
        Math.floor(
          100000 +
            Math.random() *
              900000,
        );

      const orderNumber =
        `ORD-${year}${month}${day}-${random}`;

      const existing =
        await tx.order.findUnique({
          where: {
            orderNumber,
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
      'ORDER_NUMBER_GENERATION_FAILED',
      500,
    );
  }

  private async recalculateTaxesAfterCoupon(
    params: {
      items: CalculatedItem[];
      couponDiscountCents: bigint;
      shippingAddress: {
        country: string;
        state: string | null;
      };
    },
  ): Promise<CalculatedItem[]> {
    const {
      items,
      couponDiscountCents,
      shippingAddress,
    } = params;

    if (
      couponDiscountCents === ZERO
    ) {
      return items;
    }

    const subtotalCents =
      items.reduce(
        (sum, item) =>
          sum +
          item.totalPriceCents,
        ZERO,
      );

    if (
      subtotalCents === ZERO
    ) {
      return items;
    }

    /*
     * Allocate coupon discount proportionally
     * across order items.
     */
    let allocatedDiscount =
      ZERO;

    return Promise.all(
      items.map(
        async (item, index) => {
          let itemCouponDiscount: bigint;

          if (
            index ===
            items.length - 1
          ) {
            /*
             * Last item receives the remaining amount
             * to guarantee exact total.
             */
            itemCouponDiscount =
              couponDiscountCents -
              allocatedDiscount;
          } else {
            itemCouponDiscount =
              (
                item.totalPriceCents *
                couponDiscountCents
              ) /
              subtotalCents;

            allocatedDiscount +=
              itemCouponDiscount;
          }

          const taxableAmountCents =
            item.totalPriceCents -
            itemCouponDiscount;

          const taxResult =
            await taxService.calculateForAmount({
              amountCents:
                taxableAmountCents,

              scopeKey:
                DEFAULT_SCOPE_KEY,

              countryCode:
                shippingAddress.country,

              regionCode:
                shippingAddress.state,

              variantTaxCategoryId:
                item.taxCategoryId,

              productTaxCategoryId:
                null,
            });

          return {
            ...item,

            taxableAmountCents:
              taxResult.taxableAmountCents,

            taxAmountCents:
              taxResult.taxAmountCents,

            taxRateBasisPoints:
              taxResult.rateBasisPoints,

            taxTreatment:
              taxResult.treatment,

            taxCategoryId:
              taxResult.taxCategoryId,

            taxCategoryCode:
              taxResult.taxCategoryCode,

            taxRuleId:
              taxResult.taxRuleId,
          };
        },
      ),
    );
  }
}

export const checkoutService =
  new CheckoutService();