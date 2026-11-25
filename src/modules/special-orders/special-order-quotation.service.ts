import {
  disclosePaymentTerms,
  validatePaymentTerms,
} from './special-order-payment.js';
import { AppError } from '../../common/errors/app-error.js';
import { normalizeCurrency } from '../../common/pricing/currency.js';
import { fromMinorUnits, toMinorUnits } from '../../common/pricing/money.js';
import { calculateTax } from '../../common/tax/tax.calculator.js';
import { TaxRepository } from '../../common/tax/tax.repository.js';
import { TaxService } from '../../common/tax/tax.service.js';
import type { TaxCalculationInput } from '../../common/tax/tax.types.js';
import { prisma } from '../../config/database.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  maxAttachments,
  type AttachmentData,
} from './special-order.attachments.js';
import type {
  QuotationDraft,
  QuotationSelection,
  QuotationVersion,
} from './special-order.schemas.js';
import {
  appendHistory,
  getRequest,
  invalidState,
  lockRequest,
  notify,
  notifyMerchants,
  resolveCatalogItems,
  type Actor,
  type Scope,
} from './special-order.service.js';

const quotationInclude = {
  items: { omit: { image: true }, orderBy: { position: 'asc' } },
  acceptance: {
    select: { id: true, selectionKey: true, snapshot: true, createdAt: true },
  },
} satisfies Prisma.SpecialOrderQuotationInclude;

type Quotation = Prisma.SpecialOrderQuotationGetPayload<{
  include: typeof quotationInclude;
}>;
type Tax = Omit<TaxCalculationInput, 'amountCents' | 'rateBasisPoints'> & {
  rateBasisPoints: number;
};

function notFound(): never {
  throw new AppError(
    'Special quotation not found',
    404,
    'SPECIAL_QUOTATION_NOT_FOUND',
  );
}

function conflict(): never {
  throw new AppError(
    'The quotation has changed',
    409,
    'SPECIAL_QUOTATION_CONFLICT',
  );
}

function assertVersion(
  quotation: Quotation | null,
  input: QuotationVersion,
): asserts quotation is Quotation {
  if (
    quotation?.id !== input.quotationId ||
    quotation.version !== input.version
  )
    conflict();
}

function expired(quotation: Quotation) {
  return (
    quotation.status === 'PUBLISHED' &&
    quotation.expiresAt !== null &&
    quotation.expiresAt.getTime() <= Date.now()
  );
}

function formatItem(item: Quotation['items'][number], currency: string) {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    specifications: item.specifications,
    productId: item.productId,
    variantId: item.variantId,
    requestedItemId: item.requestedItemId,
    offeredQuantity: item.offeredQuantity,
    unitPrice: fromMinorUnits(
      toMinorUnits(item.unitPrice.toFixed(), currency),
      currency,
    ),
    pricesIncludeTax: item.pricesIncludeTax,
    tax: item.tax,
    notes: item.notes,
    hasImage: item.imageContentType !== null,
  };
}

function formatAcceptance({
  id,
  createdAt,
  snapshot,
}: NonNullable<Quotation['acceptance']>) {
  return { id, createdAt, snapshot };
}

function response(quotation: Quotation) {
  const offer = quotation.items.map((item) =>
    formatItem(item, quotation.currency),
  );
  return {
    quotationId: quotation.id,
    requestId: quotation.requestId,
    tenantId: quotation.tenantId,
    version: quotation.version,
    currency: quotation.currency,
    taxCountryCode: quotation.taxCountryCode,
    sourcingDays: quotation.sourcingDays,
    paymentTerms: disclosePaymentTerms(quotation.paymentTerms),
    validityHours: quotation.validityHours,
    notes: quotation.notes,
    createdAt: quotation.createdAt,
    publishedAt: quotation.publishedAt,
    expiresAt: quotation.expiresAt,
    status: expired(quotation) ? 'EXPIRED' : quotation.status,
    sourcingFee: fromMinorUnits(
      toMinorUnits(quotation.sourcingFee.toFixed(), quotation.currency),
      quotation.currency,
    ),
    sourcingFeeDescription: quotation.sourcingFeeDescription,
    sourcingFeeTax: quotation.sourcingFeeTax,
    availableProducts: offer.filter((item) => item.type === 'AVAILABLE'),
    suggestedProducts: offer.filter((item) => item.type === 'SUGGESTED'),
    acceptance: quotation.acceptance
      ? formatAcceptance(quotation.acceptance)
      : null,
  };
}

function findQuotation(
  db: Prisma.TransactionClient,
  requestId: string,
  isDraft: boolean,
) {
  return db.specialOrderQuotation.findUnique({
    where: { requestId_isDraft: { requestId, isDraft } },
    include: quotationInclude,
  });
}

export async function getQuotations(scope: Scope, id: string) {
  await getRequest(scope, id);
  const rows = await prisma.specialOrderQuotation.findMany({
    where: {
      requestId: id,
      request: scope,
      ...(scope.customerId ? { isDraft: false } : {}),
    },
    include: quotationInclude,
  });
  const current = rows.find((quote) => !quote.isDraft);
  if (scope.customerId) return current ? response(current) : notFound();
  const draft = rows.find((quote) => quote.isDraft);
  return {
    current: current ? response(current) : null,
    draft: draft ? response(draft) : null,
  };
}

export function saveDraft(
  { tenantId }: Actor,
  id: string,
  input: QuotationDraft,
  images: Map<number, AttachmentData>,
) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, { tenantId }, id);
    if (request.status !== 'UNDER_REVIEW' && request.status !== 'QUOTED')
      invalidState();
    const existing = await findQuotation(tx, id, true);
    if (input.draft) assertVersion(existing, input.draft);
    else if (existing) conflict();

    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { defaultCurrency: true, defaultCountryCode: true },
    });
    if (!tenant.defaultCurrency || !tenant.defaultCountryCode)
      throw new AppError(
        'Tenant currency and country must be configured',
        400,
        'SPECIAL_QUOTATION_MARKET_REQUIRED',
      );
    const currency = normalizeCurrency(tenant.defaultCurrency);
    const countryCode = tenant.defaultCountryCode;
    validatePaymentTerms(input.paymentTerms, currency);
    const resolver = new TaxService(new TaxRepository(tx), true);
    const now = new Date();
    const resolveTax = async (
      pricesIncludeTax: boolean,
      categoryId?: string | null,
    ): Promise<Tax> => {
      const tax = await resolver.calculateForAmount({
        tenantId,
        currency,
        scopeKey: tenantId,
        amountCents: 0n,
        now,
        address: { countryCode },
        category: { productTaxCategoryId: categoryId ?? null },
      });
      return {
        pricesIncludeTax,
        treatment: tax.treatment,
        rateBasisPoints:
          tax.treatment === 'STANDARD' ? Number(tax.rateBasisPoints) : 0,
        taxCategoryId: tax.taxCategoryId,
        taxCategoryCode: tax.taxCategoryCode,
        taxRuleId: tax.taxRuleId,
      };
    };
    const catalog = await resolveCatalogItems(tx, tenantId, input.items);
    const sourcingFee = toMinorUnits(input.sourcingFee, currency);
    const sourcingFeeTax =
      sourcingFee === 0n && !input.sourcingFeeTaxCategoryId
        ? undefined
        : await resolveTax(
            input.sourcingFeeIncludesTax,
            input.sourcingFeeTaxCategoryId,
          );
    const retainedImageIds = input.items.flatMap((item) =>
      item.retainImageFromItemId ? [item.retainImageFromItemId] : [],
    );
    const retainedImages = retainedImageIds.length
      ? await tx.specialOrderQuotationItem.findMany({
          where: {
            id: { in: retainedImageIds },
            quotation: { requestId: id, tenantId },
            imageContentType: { not: null },
          },
          select: { id: true, image: true, imageContentType: true },
        })
      : [];
    const items = await Promise.all(
      input.items.map(async (item, position) => {
        const { productId, variantId, taxCategoryId } = catalog[position]!;
        if (
          item.requestedItemId &&
          !request.items.some(
            ({ id: itemId }) => itemId === item.requestedItemId,
          )
        )
          throw new AppError(
            'Invalid requested item reference',
            400,
            'INVALID_SPECIAL_REQUEST_ITEM',
          );
        toMinorUnits(item.unitPrice, currency);
        const image = images.get(position);
        const retained = retainedImages.find(
          ({ id: itemId }) => itemId === item.retainImageFromItemId,
        );
        if (item.retainImageFromItemId && (!retained || image))
          throw new AppError(
            'Invalid quotation image reference',
            400,
            'INVALID_ATTACHMENT',
          );
        return {
          type: item.type,
          name: item.name,
          position,
          productId,
          variantId,
          specifications: item.specifications ?? null,
          requestedItemId: item.requestedItemId ?? null,
          notes: item.notes ?? null,
          offeredQuantity: item.offeredQuantity,
          unitPrice: item.unitPrice,
          pricesIncludeTax: item.pricesIncludeTax,
          tax: await resolveTax(
            item.pricesIncludeTax,
            item.taxCategoryId ?? taxCategoryId,
          ),
          image: image?.content ?? retained?.image ?? null,
          imageContentType:
            image?.contentType ?? retained?.imageContentType ?? null,
        };
      }),
    );
    // Retaining an image must not bypass the upload limit.
    if (items.filter((item) => item.image).length > maxAttachments)
      throw new AppError(
        'Attachment limit reached',
        400,
        'SPECIAL_REQUEST_ATTACHMENT_LIMIT',
      );
    const terms = {
      currency,
      taxCountryCode: countryCode,
      sourcingDays: input.sourcingDays,
      validityHours: input.validityHours,
      notes: input.notes ?? null,
      sourcingFee: input.sourcingFee,
      sourcingFeeDescription: input.sourcingFeeDescription ?? null,
      paymentTerms: input.paymentTerms ?? Prisma.DbNull,
    };
    if (existing)
      await tx.specialOrderQuotationItem.deleteMany({
        where: { quotationId: existing.id },
      });
    const quotation = existing
      ? await tx.specialOrderQuotation.update({
          where: { id: existing.id },
          data: {
            ...terms,
            sourcingFeeTax: sourcingFeeTax ?? Prisma.DbNull,
            version: { increment: 1 },
            items: { create: items },
          },
          include: quotationInclude,
        })
      : await tx.specialOrderQuotation.create({
          data: {
            ...terms,
            requestId: id,
            tenantId,
            ...(sourcingFeeTax ? { sourcingFeeTax } : {}),
            items: { create: items },
          },
          include: quotationInclude,
        });
    return response(quotation);
  });
}

export function publish(
  { tenantId, userId }: Actor,
  id: string,
  input: QuotationVersion,
) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, { tenantId }, id);
    const current = await findQuotation(tx, id, false);
    if (
      request.status === 'QUOTED' &&
      current?.id === input.quotationId &&
      current.version === input.version
    )
      return response(current);
    if (request.status !== 'UNDER_REVIEW' && request.status !== 'QUOTED')
      invalidState();
    const draft = await findQuotation(tx, id, true);
    assertVersion(draft, input);
    if (!draft.items.length)
      throw new AppError(
        'Add at least one quotation product before publishing',
        400,
        'SPECIAL_QUOTATION_EMPTY',
      );
    await resolveCatalogItems(tx, tenantId, draft.items);
    if (current)
      await tx.specialOrderQuotation.delete({ where: { id: current.id } });
    const now = new Date();
    const published = await tx.specialOrderQuotation.update({
      where: { id: draft.id },
      data: {
        isDraft: false,
        status: 'PUBLISHED',
        publishedAt: now,
        expiresAt: new Date(now.getTime() + draft.validityHours * 3_600_000),
      },
      include: quotationInclude,
    });
    await tx.specialOrderRequest.update({
      where: { id },
      data: {
        status: 'QUOTED',
        history: appendHistory(request.history, {
          action: current ? 'QUOTATION_REPLACED' : 'QUOTED',
          actorId: userId,
          at: now.toISOString(),
          quotationId: published.id,
        }),
      },
    });
    await notify(
      tx,
      tenantId,
      id,
      request.customer.id,
      'SPECIAL_QUOTATION_PUBLISHED',
      published.id,
    );
    return response(published);
  });
}

function active(quotation: Quotation) {
  if (quotation.status !== 'PUBLISHED') invalidState();
  if (expired(quotation))
    throw new AppError(
      'Special quotation has expired',
      409,
      'SPECIAL_QUOTATION_EXPIRED',
    );
}

function calculate(quotation: Quotation, input: QuotationSelection) {
  const { currency } = quotation;
  const money = (value: bigint) => fromMinorUnits(value, currency);
  const breakdown = (amount: bigint, tax: Tax) =>
    calculateTax({
      ...tax,
      amountCents: amount,
      rateBasisPoints: BigInt(tax.rateBasisPoints),
    });
  let productsSubtotal = 0n;
  let productsTax = 0n;
  const selected = new Set<string>();
  const items = input.items.map(({ itemId, quantity }) => {
    const item = quotation.items.find((offer) => offer.id === itemId);
    if (!item || quantity > item.offeredQuantity || selected.has(itemId))
      throw new AppError(
        'Invalid quotation item or quantity',
        400,
        'INVALID_SPECIAL_QUOTATION_SELECTION',
      );
    selected.add(itemId);
    const { id, ...terms } = formatItem(item, currency);
    const unit = toMinorUnits(terms.unitPrice, currency);
    const tax = breakdown(unit * BigInt(quantity), terms.tax as unknown as Tax);
    productsSubtotal += tax.taxableAmountCents;
    productsTax += tax.taxAmountCents;
    return {
      ...terms,
      itemId: id,
      selectedQuantity: quantity,
      subtotalBeforeTax: money(tax.taxableAmountCents),
      taxAmount: money(tax.taxAmountCents),
      totalIncludingTax: money(tax.grossAmountCents),
    };
  });
  const fee = toMinorUnits(quotation.sourcingFee.toFixed(), currency);
  const feeTax = quotation.sourcingFeeTax
    ? breakdown(fee, quotation.sourcingFeeTax as unknown as Tax)
    : null;
  return {
    quotationId: quotation.id,
    version: quotation.version,
    items,
    currency,
    productsSubtotalBeforeTax: money(productsSubtotal),
    productsTax: money(productsTax),
    productsTotalIncludingTax: money(productsSubtotal + productsTax),
    sourcingFee: money(fee),
    sourcingFeeDescription: quotation.sourcingFeeDescription,
    sourcingFeeTaxTreatment: quotation.sourcingFeeTax,
    sourcingFeeSubtotalBeforeTax: money(feeTax?.taxableAmountCents ?? fee),
    sourcingFeeTax: money(feeTax?.taxAmountCents ?? 0n),
    sourcingFeeTotalIncludingTax: money(feeTax?.grossAmountCents ?? fee),
    paymentTerms: disclosePaymentTerms(quotation.paymentTerms),
    totalBeforeShipping: money(
      productsSubtotal + productsTax + (feeTax?.grossAmountCents ?? fee),
    ),
  };
}

export function calculateSelection(
  { tenantId, userId }: Actor,
  id: string,
  input: QuotationSelection,
) {
  return prisma.$transaction(async (tx) => {
    await lockRequest(tx, { tenantId, customerId: userId }, id);
    const quotation = await findQuotation(tx, id, false);
    assertVersion(quotation, input);
    active(quotation);
    return calculate(quotation, input);
  });
}

export function accept(
  { tenantId, userId }: Actor,
  id: string,
  input: QuotationSelection,
) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, { tenantId, customerId: userId }, id);
    const quotation = await findQuotation(tx, id, false);
    assertVersion(quotation, input);
    const selectionKey = JSON.stringify(
      input.items
        .map(({ itemId, quantity }) => [itemId, quantity] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
    if (quotation.acceptance) {
      if (quotation.acceptance.selectionKey !== selectionKey) conflict();
      return formatAcceptance(quotation.acceptance);
    }
    if (request.status !== 'QUOTED') invalidState();
    active(quotation);
    const snapshot = {
      ...calculate(quotation, input),
      sourcingDays: quotation.sourcingDays,
      taxCountryCode: quotation.taxCountryCode,
      notes: quotation.notes,
    };
    const acceptance = await tx.specialOrderAcceptance.create({
      data: { quotationId: quotation.id, selectionKey, snapshot },
      select: { id: true, createdAt: true, snapshot: true },
    });
    await tx.specialOrderQuotation.update({
      where: { id: quotation.id },
      data: { status: 'ACCEPTED' },
    });
    await tx.specialOrderQuotation.deleteMany({
      where: { requestId: id, isDraft: true },
    });
    await tx.specialOrderRequest.update({
      where: { id },
      data: {
        status: 'ACCEPTED',
        history: appendHistory(request.history, {
          action: 'ACCEPTED',
          actorId: userId,
          at: acceptance.createdAt.toISOString(),
          quotationId: quotation.id,
        }),
      },
    });
    await notifyMerchants(
      tx,
      tenantId,
      id,
      'SPECIAL_QUOTATION_ACCEPTED',
      quotation.id,
    );
    return acceptance;
  });
}

export function reject(
  { tenantId, userId }: Actor,
  id: string,
  input: QuotationVersion & { reason?: string | undefined },
) {
  return prisma.$transaction(async (tx) => {
    const scope = { tenantId, customerId: userId };
    const request = await lockRequest(tx, scope, id);
    if (request.status !== 'QUOTED') invalidState();
    const quotation = await findQuotation(tx, id, false);
    assertVersion(quotation, input);
    await tx.specialOrderQuotation.deleteMany({ where: { requestId: id } });
    await tx.specialOrderRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: input.reason ?? null,
        history: appendHistory(request.history, {
          action: 'CUSTOMER_REJECTED_QUOTATION',
          actorId: userId,
          at: new Date().toISOString(),
          quotationId: quotation.id,
        }),
      },
    });
    await notifyMerchants(
      tx,
      tenantId,
      id,
      'SPECIAL_QUOTATION_REJECTED',
      quotation.id,
    );
    return { id, status: 'REJECTED', rejectionReason: input.reason ?? null };
  });
}

export async function getImage(
  scope: Scope,
  requestId: string,
  quotationId: string,
  itemId: string,
) {
  const item = await prisma.specialOrderQuotationItem.findFirst({
    where: {
      id: itemId,
      quotationId,
      quotation: {
        requestId,
        request: scope,
        ...(scope.customerId ? { isDraft: false } : {}),
      },
    },
    select: { image: true, imageContentType: true },
  });
  if (!item?.image || !item.imageContentType) notFound();
  return { content: item.image, contentType: item.imageContentType };
}
