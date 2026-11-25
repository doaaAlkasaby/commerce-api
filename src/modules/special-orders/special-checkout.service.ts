import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { currencyPrecision } from '../../common/pricing/currency.js';
import {
  fromMinorUnits,
  parseDecimal,
  toMinorUnits,
} from '../../common/pricing/money.js';
import { ShippingRepository } from '../../common/shipping/shipping.repository.js';
import { ShippingService } from '../../common/shipping/shipping.service.js';
import { TaxRepository } from '../../common/tax/tax.repository.js';
import { TaxService } from '../../common/tax/tax.service.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { Prisma } from '../../generated/prisma/client.js';
import { createOrderAddressSnapshot } from '../addresses/address.snapshot.js';
import {
  disclosePaymentTerms,
  paymentOptions,
} from './special-order-payment.js';
import type {
  checkoutConfirmSchema,
  checkoutPreviewSchema,
} from './special-order.schemas.js';
import {
  appendHistory,
  lockRequest,
  notify,
  notifyMerchants,
  type Actor,
} from './special-order.service.js';
import { orderDetail, presentOrder } from './special-orders-read.service.js';

type CheckoutInput = z.infer<typeof checkoutPreviewSchema>;
type ConfirmInput = z.infer<typeof checkoutConfirmSchema>;
type Tx = Prisma.TransactionClient;
const money = z.string().regex(/^\d+(\.\d{1,4})?$/);
const taxTerms = z.object({
  pricesIncludeTax: z.boolean(),
  taxCategoryCode: z.string(),
  taxRuleId: z.string(),
  taxCategoryId: z.string(),
  treatment: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']),
  rateBasisPoints: z.number().int().min(0).max(10_000),
});
const snapshotSchema = z.looseObject({
  quotationId: z.uuid(),
  version: z.number().int().positive(),
  currency: z.string(),
  taxCountryCode: z.string(),
  sourcingDays: z.number().int(),
  notes: z.string().nullable(),
  sourcingFeeDescription: z.string().nullable(),
  sourcingFeeTaxTreatment: taxTerms.nullable(),
  items: z
    .array(
      z.object({
        itemId: z.uuid(),
        name: z.string(),
        specifications: z.string().nullable(),
        productId: z.uuid().nullable(),
        variantId: z.uuid().nullable(),
        selectedQuantity: z.number().int().positive(),
        unitPrice: money,
        pricesIncludeTax: z.boolean(),
        tax: taxTerms,
        notes: z.string().nullable(),
        subtotalBeforeTax: money,
        taxAmount: money,
        totalIncludingTax: money,
        hasImage: z.boolean(),
      }),
    )
    .min(1),
  productsSubtotalBeforeTax: money,
  productsTax: money,
  productsTotalIncludingTax: money,
  sourcingFeeSubtotalBeforeTax: money,
  sourcingFeeTax: money,
  sourcingFeeTotalIncludingTax: money,
});
const pickupSchema = z.object({
  id: z.string().min(1).max(100),
  enabled: z.literal(true),
  name: z.string().min(1).max(160),
  address: z.string().min(1).max(500),
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  regionCode: z.string().max(100).nullish(),
  instructions: z.string().max(1000).nullish(),
});
const configurationSchema = z.object({
  cashEnabled: z.boolean().default(true),
  pickupLocations: z.array(z.unknown()).max(100).default([]),
});

function conflict(
  message = 'Review an updated Special Checkout preview before confirming',
): never {
  throw new AppError(message, 409, 'SPECIAL_CHECKOUT_CONFLICT');
}

function taxConflict(): never {
  throw new AppError(
    'The fulfillment destination requires different tax terms. Request a new quotation before confirming.',
    409,
    'SPECIAL_CHECKOUT_TAX_CONFLICT',
  );
}

const scopeFor = ({ tenantId, userId }: Actor) => ({
  tenantId,
  customerId: userId,
});

async function configuration(tx: Tx, tenantId: string) {
  const row = await tx.appSetting.findUnique({
    where: { tenantId_key: { tenantId, key: 'special_checkout' } },
    select: { value: true },
  });
  const config = configurationSchema.parse(row?.value ?? {});
  const pickupLocations = config.pickupLocations.flatMap((location) => {
    const parsed = pickupSchema.safeParse(location);
    if (!parsed.success) return [];
    const { enabled, ...publicLocation } = parsed.data;
    return [publicLocation];
  });
  return {
    cashEnabled: config.cashEnabled,
    pickupLocations: pickupLocations.filter(
      ({ id }) =>
        pickupLocations.filter((location) => location.id === id).length === 1,
    ),
  };
}

type LockedRequest = Awaited<ReturnType<typeof lockRequest>>;

async function activeAcceptance(
  tx: Tx,
  request: LockedRequest,
  acceptanceId?: string,
  lock = false,
) {
  if (request.status !== 'ACCEPTED' || request.finalOrder)
    conflict('An active accepted quotation is required');
  if (lock)
    await tx.$queryRaw`
    SELECT acceptance.id FROM "SpecialOrderAcceptance" AS acceptance
    JOIN "SpecialOrderQuotation" AS quotation ON quotation.id = acceptance."quotationId"
    WHERE quotation."requestId" = ${request.id} AND NOT quotation."isDraft"
    FOR UPDATE OF acceptance
  `;
  const quotation = await tx.specialOrderQuotation.findFirst({
    where: { requestId: request.id, isDraft: false, status: 'ACCEPTED' },
    select: { id: true, version: true, paymentTerms: true, acceptance: true },
  });
  const acceptance = quotation?.acceptance;
  if (
    !quotation ||
    !acceptance ||
    acceptance.consumedAt ||
    (acceptanceId && acceptance.id !== acceptanceId)
  ) {
    conflict('The accepted quotation has changed');
  }
  const parsed = snapshotSchema.safeParse(acceptance.snapshot);
  if (
    !parsed.success ||
    parsed.data.quotationId !== quotation.id ||
    parsed.data.version !== quotation.version
  ) {
    conflict('The accepted quotation snapshot is invalid');
  }
  const snapshot = parsed.data;
  const key = JSON.stringify(
    snapshot.items
      .map(
        ({ itemId, selectedQuantity }) => [itemId, selectedQuantity] as const,
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  if (key !== acceptance.selectionKey)
    conflict('The accepted product selection has changed');
  const acceptedTerms = disclosePaymentTerms(quotation.paymentTerms);
  if (
    (snapshot.paymentTerms === undefined && quotation.paymentTerms !== null) ||
    (snapshot.paymentTerms !== undefined &&
      canonical(snapshot.paymentTerms) !== canonical(acceptedTerms))
  ) {
    conflict('Payment terms were not accepted');
  }
  return {
    id: acceptance.id,
    acceptedAt: acceptance.createdAt,
    snapshot,
    acceptedTerms,
  };
}

type Accepted = Awaited<ReturnType<typeof activeAcceptance>>;

function checkoutInfo(request: LockedRequest, accepted: Accepted) {
  const { snapshot } = accepted;
  return {
    requestId: request.id,
    requestNumber: request.requestNumber,
    acceptanceId: accepted.id,
    quotationId: snapshot.quotationId,
    quotationVersion: snapshot.version,
    acceptedAt: accepted.acceptedAt.toISOString(),
    products: snapshot.items,
    acceptedFinancials: {
      productsSubtotalBeforeTax: snapshot.productsSubtotalBeforeTax,
      productsTax: snapshot.productsTax,
      productsTotalIncludingTax: snapshot.productsTotalIncludingTax,
      sourcingFeeSubtotalBeforeTax: snapshot.sourcingFeeSubtotalBeforeTax,
      sourcingFeeTax: snapshot.sourcingFeeTax,
      sourcingFeeTotalIncludingTax: snapshot.sourcingFeeTotalIncludingTax,
    },
    quotationNotes: snapshot.notes,
    estimatedSourcingDays: snapshot.sourcingDays,
    currency: snapshot.currency,
    quotedPaymentTerms: accepted.acceptedTerms,
  };
}

export function getCheckout(actor: Actor, id: string) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, scopeFor(actor), id);
    return checkoutInfo(request, await activeAcceptance(tx, request));
  });
}

async function ownedAddress(tx: Tx, userId: string, addressId: string) {
  const address = await tx.address.findFirst({
    where: { id: addressId, userId, country: { isActive: true } },
  });
  if (!address)
    throw new AppError(
      'Shipping address not found',
      404,
      'SHIPPING_ADDRESS_NOT_FOUND',
    );
  return address;
}

type Destination = { countryCode: string; regionCode: string | null };
function addressSnapshot(address: Awaited<ReturnType<typeof ownedAddress>>) {
  return {
    ...createOrderAddressSnapshot({ ...address, country: address.countryCode }),
    id: address.id,
    countryCode: address.countryCode,
    latitude: address.latitude?.toFixed() ?? null,
    longitude: address.longitude?.toFixed() ?? null,
  };
}

function taxResolver(
  tx: Tx,
  actor: Actor,
  accepted: Accepted,
  destination: Destination,
) {
  const tax = new TaxService(new TaxRepository(tx), true);
  const now = new Date();
  return (amountCents: bigint, productTaxCategoryId?: string) =>
    tax.calculateForAmount({
      tenantId: actor.tenantId,
      scopeKey: actor.tenantId,
      currency: accepted.snapshot.currency,
      address: destination,
      now,
      category: productTaxCategoryId ? { productTaxCategoryId } : {},
      amountCents,
    });
}

async function verifyDestinationTax(
  accepted: Accepted,
  destination: Destination,
  resolve: ReturnType<typeof taxResolver>,
) {
  if (accepted.snapshot.taxCountryCode !== destination.countryCode)
    taxConflict();
  const taxes = accepted.snapshot.items.map(({ tax }) => tax);
  if (accepted.snapshot.sourcingFeeTaxTreatment)
    taxes.push(accepted.snapshot.sourcingFeeTaxTreatment);
  const unique = new Map(taxes.map((tax) => [tax.taxCategoryId, tax]));
  for (const quoted of unique.values()) {
    try {
      const current = await resolve(0n, quoted.taxCategoryId);
      const currentRate =
        current.treatment === 'STANDARD' ? current.rateBasisPoints : 0n;
      if (
        current.treatment !== quoted.treatment ||
        currentRate !== BigInt(quoted.rateBasisPoints)
      )
        taxConflict();
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        (error.statusCode >= 500 && error.code !== 'TAX_CURRENCY_MISMATCH')
      )
        throw error;
      taxConflict();
    }
  }
}

const unavailableShipping = new Set([
  'SHIPPING_METHOD_NOT_AVAILABLE',
  'SHIPPING_NOT_AVAILABLE',
  'SHIPPING_ZONE_NOT_AVAILABLE',
  'DELIVERY_COORDINATES_REQUIRED',
  'SHIPPING_ORIGIN_COORDINATES_REQUIRED',
]);

async function deliveryOptions(
  tx: Tx,
  actor: Actor,
  accepted: Accepted,
  address: Awaited<ReturnType<typeof ownedAddress>>,
) {
  const destination = {
    countryCode: address.countryCode,
    regionCode: address.state,
    city: address.city,
    latitude: address.latitude === null ? null : Number(address.latitude),
    longitude: address.longitude === null ? null : Number(address.longitude),
  };
  const resolve = taxResolver(tx, actor, accepted, destination);
  await verifyDestinationTax(accepted, destination, resolve);
  const repository = new ShippingRepository(tx);
  const profile = await repository.findProfile(
    actor.tenantId,
    destination.countryCode,
  );
  const shipping = new ShippingService(repository);
  const { currency, items } = accepted.snapshot;
  const format = (value: bigint) => fromMinorUnits(value, currency);
  // Match the regular shipping contract's quoted unit-price extensions.
  const orderSubtotalCents = items.reduce(
    (total, item) =>
      total +
      toMinorUnits(item.unitPrice, currency) * BigInt(item.selectedQuantity),
    0n,
  );
  const codes = [
    ...new Set(
      profile?.zones.flatMap(({ methods }) => methods.map(({ code }) => code)),
    ),
  ].sort();
  const options = [];
  for (const methodCode of codes) {
    try {
      const result = await shipping.calculate({
        tenantId: actor.tenantId,
        scopeKey: actor.tenantId,
        currency,
        orderSubtotalCents,
        destination,
        methodCode,
      });
      const tax =
        result.amountCents > 0n ? await resolve(result.amountCents) : null;
      options.push({
        id: result.shippingMethodId,
        code: result.shippingMethodCode,
        name: result.shippingMethodName,
        ruleId: result.shippingRuleId,
        distanceKm: result.distanceKm,
        shippingSubtotalBeforeTax: format(tax?.taxableAmountCents ?? 0n),
        shippingTax: format(tax?.taxAmountCents ?? 0n),
        shippingTotalIncludingTax: format(tax?.grossAmountCents ?? 0n),
        tax: tax
          ? {
              categoryId: tax.taxCategoryId,
              rateBasisPoints: Number(tax.rateBasisPoints),
              treatment: tax.treatment,
              pricesIncludeTax: tax.pricesIncludeTax,
              rule: tax.ruleSnapshot,
            }
          : null,
        deliveryEstimate: null,
      });
    } catch (error) {
      if (!(error instanceof AppError) || !unavailableShipping.has(error.code))
        throw error;
    }
  }
  return options;
}

export function getCheckoutOptions(
  actor: Actor,
  id: string,
  addressId?: string,
) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, scopeFor(actor), id);
    const accepted = await activeAcceptance(tx, request);
    const config = await configuration(tx, actor.tenantId);
    const pickupLocations = [];
    for (const pickup of config.pickupLocations) {
      const destination = {
        countryCode: pickup.countryCode,
        regionCode: pickup.regionCode ?? null,
      };
      try {
        await verifyDestinationTax(
          accepted,
          destination,
          taxResolver(tx, actor, accepted, destination),
        );
        pickupLocations.push(pickup);
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          error.code !== 'SPECIAL_CHECKOUT_TAX_CONFLICT'
        )
          throw error;
      }
    }
    if (addressId) {
      const address = await ownedAddress(tx, actor.userId, addressId);
      return {
        acceptanceId: accepted.id,
        deliveryAddress: addressSnapshot(address),
        shippingOptions: await deliveryOptions(tx, actor, accepted, address),
        pickupLocations,
      };
    }
    const addresses = await tx.address.findMany({
      where: {
        userId: actor.userId,
        countryCode: accepted.snapshot.taxCountryCode,
        country: { isActive: true },
      },
      orderBy: [{ isDefaultShipping: 'desc' }, { id: 'asc' }],
    });
    const deliveryAddresses = [];
    for (const address of addresses) {
      try {
        if ((await deliveryOptions(tx, actor, accepted, address)).length)
          deliveryAddresses.push(addressSnapshot(address));
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          error.code !== 'SPECIAL_CHECKOUT_TAX_CONFLICT'
        )
          throw error;
      }
    }
    return { acceptanceId: accepted.id, deliveryAddresses, pickupLocations };
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => JSON.stringify(key) + ':' + canonical(entry))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}

async function calculate(
  tx: Tx,
  actor: Actor,
  request: LockedRequest,
  accepted: Accepted,
  input: CheckoutInput,
) {
  const config = await configuration(tx, actor.tenantId);
  const { snapshot } = accepted;
  const { currency } = snapshot;
  const selected = input.fulfillment;
  const zero = fromMinorUnits(0n, currency);
  let deliveryAddress = null;
  let pickupLocation = null;
  let shippingOptions: Awaited<ReturnType<typeof deliveryOptions>> = [];
  let shippingMethod: (typeof shippingOptions)[number] | null = null;
  if (selected.method === 'HOME_DELIVERY') {
    const address = await ownedAddress(tx, actor.userId, selected.addressId);
    deliveryAddress = addressSnapshot(address);
    shippingOptions = await deliveryOptions(tx, actor, accepted, address);
    shippingMethod =
      (selected.shippingMethodCode
        ? shippingOptions.find(
            ({ code }) => code === selected.shippingMethodCode,
          )
        : shippingOptions[0]) ?? null;
    if (!shippingMethod)
      throw new AppError(
        'No matching shipping option is available',
        409,
        'SPECIAL_SHIPPING_UNAVAILABLE',
      );
  } else {
    pickupLocation =
      config.pickupLocations.find(
        ({ id }) => id === selected.pickupLocationId,
      ) ?? null;
    if (!pickupLocation)
      throw new AppError(
        'Pickup location not found',
        404,
        'SPECIAL_PICKUP_NOT_FOUND',
      );
    const destination = {
      countryCode: pickupLocation.countryCode,
      regionCode: pickupLocation.regionCode ?? null,
    };
    await verifyDestinationTax(
      accepted,
      destination,
      taxResolver(tx, actor, accepted, destination),
    );
  }
  // The strict unit-price cap does not apply to totals across multiple units.
  const scale = (10n ** BigInt(currencyPrecision(currency))).toString();
  const totalMinorUnits = (value: string) =>
    BigInt(parseDecimal(value).mul(scale).toFixed(0));
  const products = totalMinorUnits(snapshot.productsTotalIncludingTax);
  const shippingTotalIncludingTax =
    shippingMethod?.shippingTotalIncludingTax ?? zero;
  const total =
    products +
    totalMinorUnits(snapshot.sourcingFeeTotalIncludingTax) +
    totalMinorUnits(shippingTotalIncludingTax);
  const financials = {
    currency,
    productsSubtotalBeforeTax: snapshot.productsSubtotalBeforeTax,
    productsTax: snapshot.productsTax,
    productsTotalIncludingTax: snapshot.productsTotalIncludingTax,
    sourcingFeeSubtotalBeforeTax: snapshot.sourcingFeeSubtotalBeforeTax,
    sourcingFeeTax: snapshot.sourcingFeeTax,
    sourcingFeeTotalIncludingTax: snapshot.sourcingFeeTotalIncludingTax,
    shippingSubtotalBeforeTax:
      shippingMethod?.shippingSubtotalBeforeTax ?? zero,
    shippingTax: shippingMethod?.shippingTax ?? zero,
    shippingTotalIncludingTax,
    grandTotal: fromMinorUnits(total, currency),
  };
  const payments = await paymentOptions(
    tx,
    actor.tenantId,
    snapshot.taxCountryCode,
    currency,
    accepted.acceptedTerms,
    config.cashEnabled,
    products,
    total,
  );
  const availablePaymentTerms = payments.filter(({ executable }) => executable);
  const selectedPaymentTerms = input.paymentMethod
    ? availablePaymentTerms.find(({ method }) => method === input.paymentMethod)
    : availablePaymentTerms[0];
  if (input.paymentMethod && !selectedPaymentTerms) {
    throw new AppError(
      'The selected payment terms are unavailable for Special Checkout',
      409,
      'SPECIAL_PAYMENT_UNAVAILABLE',
    );
  }
  const preview = {
    ...checkoutInfo(request, accepted),
    fulfillmentMethod: selected.method,
    deliveryAddress,
    pickupLocation,
    shippingOptions,
    shippingMethod,
    availablePaymentTerms,
    deferredPaymentTerms: payments.filter(
      ({ executable, method }) =>
        !executable && method !== 'CASH_ON_FULFILLMENT',
    ),
    selectedPaymentTerms: selectedPaymentTerms ?? null,
    financials,
    deliveryEstimate: shippingMethod?.deliveryEstimate ?? null,
  };
  return {
    ...preview,
    previewToken: selectedPaymentTerms
      ? createHmac('sha256', env.JWT_ACCESS_SECRET)
          .update(canonical({ actor, preview }))
          .digest('hex')
      : null,
  };
}

export function previewCheckout(
  actor: Actor,
  id: string,
  input: CheckoutInput,
) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, scopeFor(actor), id);
    return calculate(
      tx,
      actor,
      request,
      await activeAcceptance(tx, request, input.acceptanceId),
      input,
    );
  });
}

export async function confirmCheckout(
  actor: Actor,
  id: string,
  key: string,
  input: ConfirmInput,
) {
  const scope = scopeFor(actor);
  const fingerprint = createHash('sha256')
    .update(canonical(input))
    .digest('hex');
  try {
    return await prisma.$transaction(async (tx) => {
      const request = await lockRequest(tx, scope, id);
      const existing = await tx.specialOrder.findFirst({
        where: { ...scope, OR: [{ requestId: id }, { idempotencyKey: key }] },
        include: orderDetail,
      });
      if (existing) {
        if (
          existing.requestId !== id ||
          existing.idempotencyKey !== key ||
          existing.requestFingerprint !== fingerprint
        ) {
          conflict(
            'This checkout was already confirmed or the idempotency key is already in use',
          );
        }
        return { order: presentOrder(existing), replayed: true };
      }
      const accepted = await activeAcceptance(
        tx,
        request,
        input.acceptanceId,
        true,
      );
      const preview = await calculate(
        tx,
        actor,
        request,
        accepted,
        input,
      ).catch((error: unknown) => {
        if (
          error instanceof AppError &&
          error.statusCode < 500 &&
          error.code !== 'SPECIAL_CHECKOUT_TAX_CONFLICT'
        )
          conflict();
        throw error;
      });
      const payment = preview.selectedPaymentTerms;
      if (
        !payment ||
        !preview.previewToken ||
        !timingSafeEqual(
          Buffer.from(preview.previewToken, 'hex'),
          Buffer.from(input.previewToken, 'hex'),
        )
      )
        conflict();
      const { snapshot } = accepted;
      const quoteItems = await tx.specialOrderQuotationItem.findMany({
        where: {
          quotationId: snapshot.quotationId,
          id: { in: snapshot.items.map(({ itemId }) => itemId) },
        },
        select: { id: true },
      });
      if (quoteItems.length !== snapshot.items.length)
        conflict('The accepted product selection is invalid');
      const customer = await tx.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { email: true, firstName: true, lastName: true },
      });
      // The tenant-scoped request number is already unique and transactionally allocated.
      const order = await tx.specialOrder.create({
        data: {
          ...scope,
          requestId: id,
          acceptanceId: accepted.id,
          number: Number(request.requestNumber.slice(3)),
          currency: snapshot.currency,
          fulfillmentMethod: preview.fulfillmentMethod,
          customerFirstName: customer.firstName,
          customerLastName: customer.lastName,
          customerEmail: customer.email,
          customerPhone: request.contactPhone,
          deliveryAddress: preview.deliveryAddress ?? Prisma.DbNull,
          pickupLocation: preview.pickupLocation ?? Prisma.DbNull,
          shippingMethod: preview.shippingMethod ?? Prisma.DbNull,
          financials: preview.financials,
          grandTotal: preview.financials.grandTotal,
          paymentTerms: payment,
          initialPayment: payment.initialPayment,
          remainingBalance: payment.remainingBalance,
          commercialTerms: {
            quotationId: snapshot.quotationId,
            quotationVersion: snapshot.version,
            acceptedAt: accepted.acceptedAt.toISOString(),
            notes: snapshot.notes,
            taxCountryCode: snapshot.taxCountryCode,
            sourcingFeeDescription: snapshot.sourcingFeeDescription,
            sourcingFeeTaxTreatment: snapshot.sourcingFeeTaxTreatment,
            authorizedPaymentTerms: accepted.acceptedTerms,
          },
          sourcingDays: snapshot.sourcingDays,
          idempotencyKey: key,
          requestFingerprint: fingerprint,
          paymentObligations: {
            create: [
              ...(payment.method === 'CASH_ON_FULFILLMENT'
                ? []
                : [
                    {
                      kind: 'INITIAL' as const,
                      method: 'ONLINE' as const,
                      amount: payment.initialPayment,
                      currency: snapshot.currency,
                      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
                    },
                  ]),
              ...(payment.method === 'FULL_ADVANCE_ONLINE'
                ? []
                : [
                    {
                      kind: 'BALANCE' as const,
                      method:
                        payment.method === 'DEPOSIT_REMAINING_ONLINE'
                          ? ('ONLINE' as const)
                          : ('CASH' as const),
                      amount: payment.remainingBalance,
                      currency: snapshot.currency,
                    },
                  ]),
            ],
          },
          items: {
            create: snapshot.items.map(
              ({ itemId, selectedQuantity, ...item }, position) => ({
                ...item,
                quotationItemId: itemId,
                quantity: selectedQuantity,
                position,
              }),
            ),
          },
        },
        include: orderDetail,
      });
      const consumed = await tx.specialOrderAcceptance.updateMany({
        where: { id: accepted.id, consumedAt: null },
        data: { consumedAt: order.createdAt },
      });
      if (consumed.count !== 1) conflict('The acceptance was already consumed');
      await tx.specialOrderRequest.update({
        where: { id },
        data: {
          status: 'ORDER_CREATED',
          history: appendHistory(request.history, {
            action: 'ORDER_CREATED',
            actorId: actor.userId,
            at: order.createdAt.toISOString(),
            quotationId: snapshot.quotationId,
          }),
        },
      });
      await tx.specialOrderQuotation.deleteMany({
        where: { requestId: id, isDraft: true },
      });
      await tx.specialOrderQuotationItem.deleteMany({
        where: {
          quotationId: snapshot.quotationId,
          id: { notIn: quoteItems.map(({ id: itemId }) => itemId) },
        },
      });
      await notify(
        tx,
        actor.tenantId,
        id,
        actor.userId,
        'SPECIAL_ORDER_CREATED',
        order.id,
      );
      await notifyMerchants(
        tx,
        actor.tenantId,
        id,
        'SPECIAL_ORDER_CREATED',
        order.id,
      );
      return { order: presentOrder(order), replayed: false };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      conflict('The checkout or idempotency key is already in use');
    throw error;
  }
}
