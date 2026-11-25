import { z } from 'zod';
import { paginationQuerySchema } from '../../common/pagination/pagination.js';

const item = z.strictObject({
  name: z.string().trim().min(1).max(160),
  quantity: z.number().int().min(1).max(10_000),
  specifications: z.string().trim().max(2000).nullish(),
  productId: z.uuid().nullish(),
  variantId: z.uuid().nullish(),
});

export const contactPhoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^\+?[0-9][0-9 ().-]*$/)
  .transform((value) => value.replace(/[ ().-]/g, ''))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/));

export const createRequestSchema = z.strictObject({
  contactPhone: contactPhoneSchema.optional(),
  notes: z.string().trim().max(2000).nullish(),
  items: z.array(item).min(1).max(20),
});

export const quotationActionStateSchema = z.strictObject({
  quotationId: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(['QUOTED', 'ACCEPTED']),
});
export const quotationCancelSchema = z
  .union([
    quotationActionStateSchema,
    z.strictObject({}).transform(() => undefined),
  ])
  .optional();
export type QuotationActionState = z.infer<typeof quotationActionStateSchema>;

export const editRequestSchema = createRequestSchema.extend({
  resubmit: quotationActionStateSchema.optional(),
  removeAttachmentIds: z.array(z.uuid()).max(6).optional(),
  items: z
    .array(item.extend({ id: z.uuid().optional() }))
    .min(1)
    .max(20),
});

export const requestIdSchema = z.strictObject({ id: z.uuid() });
export const specialAttemptParams = requestIdSchema.extend({
  attemptId: z.uuid(),
});
export const specialPaymentInitiationSchema = z.strictObject({
  obligationId: z.uuid(),
});
export const specialPaymentVerificationSchema = z.strictObject({}).optional();
export const attachmentParamsSchema = requestIdSchema.extend({
  attachmentId: z.uuid(),
});
export const attachmentInputSchema = z.strictObject({
  itemId: z.uuid().optional(),
});
export const idempotencyKeySchema = z
  .string()
  .trim()
  .regex(/^[!-~]{1,128}$/);
export const rejectRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(1000),
});
export const requestListSchema = paginationQuerySchema;
export const merchantListSchema = paginationQuerySchema.extend({
  status: z
    .enum([
      'NEW',
      'UNDER_REVIEW',
      'QUOTED',
      'ACCEPTED',
      'REJECTED',
      'CANCELLED',
      'ORDER_CREATED',
    ])
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type CreateRequest = z.infer<typeof createRequestSchema>;
export type EditRequest = z.infer<typeof editRequestSchema>;
export type RequestList = z.infer<typeof merchantListSchema>;

const amount = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/);
export const specialPaymentMethod = z.enum([
  'CASH_ON_FULFILLMENT',
  'FULL_ADVANCE_ONLINE',
  'DEPOSIT_REMAINING_CASH',
  'DEPOSIT_REMAINING_ONLINE',
]);

const deposit = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('FIXED'), amount }),
  z.strictObject({
    type: z.literal('PERCENTAGE'),
    percentage: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
  }),
]);

export const quotationPaymentTerms = z
  .array(
    z.discriminatedUnion('method', [
      z.strictObject({ method: z.literal('CASH_ON_FULFILLMENT') }),
      z.strictObject({ method: z.literal('FULL_ADVANCE_ONLINE') }),
      z.strictObject({ method: z.literal('DEPOSIT_REMAINING_CASH'), deposit }),
      z.strictObject({
        method: z.literal('DEPOSIT_REMAINING_ONLINE'),
        deposit,
      }),
    ]),
  )
  .min(1)
  .max(4)
  .refine(
    (terms) => new Set(terms.map(({ method }) => method)).size === terms.length,
  );

export const checkoutFulfillmentSchema = z.discriminatedUnion('method', [
  z.strictObject({
    method: z.literal('HOME_DELIVERY'),
    addressId: z.uuid(),
    shippingMethodCode: z.string().trim().min(1).max(100).optional(),
  }),
  z.strictObject({
    method: z.literal('STORE_PICKUP'),
    pickupLocationId: z.string().min(1).max(100),
  }),
]);

export const checkoutPreviewSchema = z.strictObject({
  acceptanceId: z.uuid(),
  fulfillment: checkoutFulfillmentSchema,
  paymentMethod: specialPaymentMethod.optional(),
});

export const checkoutConfirmSchema = checkoutPreviewSchema.extend({
  fulfillment: z.discriminatedUnion('method', [
    checkoutFulfillmentSchema.options[0].required(),
    checkoutFulfillmentSchema.options[1],
  ]),
  paymentMethod: specialPaymentMethod,
  previewToken: z.string().regex(/^[a-f0-9]{64}$/),
});

export const checkoutOptionsSchema = z.strictObject({
  addressId: z.uuid().optional(),
});
export const specialOrderListSchema = paginationQuerySchema.extend({
  state: z
    .enum([
      'PENDING_SOURCING',
      'SOURCING',
      'READY_FOR_FULFILLMENT',
      'SHIPPED',
      'DELIVERED',
      'AWAITING_PICKUP',
      'PICKED_UP',
    ])
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const quoteItem = z.strictObject({
  type: z.enum(['AVAILABLE', 'SUGGESTED']),
  name: z.string().trim().min(1).max(160),
  specifications: z.string().trim().max(2000).nullish(),
  productId: z.uuid().nullish(),
  variantId: z.uuid().nullish(),
  requestedItemId: z.uuid().nullish(),
  offeredQuantity: z.number().int().min(1).max(10_000),
  unitPrice: amount,
  pricesIncludeTax: z.boolean(),
  taxCategoryId: z.uuid().optional(),
  notes: z.string().trim().max(2000).nullish(),
  retainImageFromItemId: z.uuid().optional(),
});

export const quotationDraftSchema = z.strictObject({
  draft: z
    .strictObject({
      quotationId: z.uuid(),
      version: z.number().int().positive(),
    })
    .optional(),
  sourcingDays: z.number().int().min(0).max(365),
  validityHours: z.number().int().min(1).max(720).default(48),
  notes: z.string().trim().max(2000).nullish(),
  paymentTerms: quotationPaymentTerms.optional(),
  sourcingFee: amount.default('0'),
  sourcingFeeDescription: z.string().trim().max(1000).nullish(),
  sourcingFeeTaxCategoryId: z.uuid().optional(),
  sourcingFeeIncludesTax: z.boolean().default(false),
  items: z.array(quoteItem).max(40),
});

export const quotationVersionSchema = z.strictObject({
  quotationId: z.uuid(),
  version: z.number().int().positive(),
});
export const quotationSelectionSchema = quotationVersionSchema.extend({
  items: z
    .array(
      z.strictObject({
        itemId: z.uuid(),
        quantity: z.number().int().min(1).max(10_000),
      }),
    )
    .min(1)
    .max(40),
});
export const customerQuotationRejectionSchema = quotationVersionSchema.extend({
  reason: z.string().trim().min(1).max(1000).optional(),
});
export const quotationImageParamsSchema = requestIdSchema.extend({
  quotationId: z.uuid(),
  itemId: z.uuid(),
});
export type QuotationDraft = z.infer<typeof quotationDraftSchema>;
export type QuotationVersion = z.infer<typeof quotationVersionSchema>;
export type QuotationSelection = z.infer<typeof quotationSelectionSchema>;

export const sourcingActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('START'), warehouseId: z.uuid() }),
  z.strictObject({ action: z.literal('RESERVE') }),
  z.strictObject({ action: z.literal('READY') }),
  z.strictObject({
    action: z.literal('RECEIVE'),
    itemId: z.uuid(),
    quantity: z.number().int().min(1).max(10_000),
  }),
  z.strictObject({
    action: z.literal('SECURE'),
    itemId: z.uuid(),
    quantity: z.number().int().min(1).max(10_000),
  }),
]);

const fulfillmentEvidence = z.string().trim().min(1).max(500);
const fulfillmentDate = z.iso.datetime({ offset: true });
const fulfillmentTime = { occurredAt: fulfillmentDate.optional() };
const handover = {
  ...fulfillmentTime,
  handedOver: z.boolean(),
  evidence: fulfillmentEvidence,
  cash: z
    .strictObject({
      observedAmount: z.string().regex(/^\d{1,16}(\.\d{1,4})?$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
      reference: fulfillmentEvidence,
    })
    .optional(),
};
const trackingUrl = z
  .url()
  .max(500)
  .refine((value) => {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
export const fulfillmentActionSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('DISPATCH'),
    ...fulfillmentTime,
    deliveryMethod: z.enum(['MERCHANT', 'EXTERNAL_CARRIER']),
    carrierName: z.string().trim().min(1).max(160).optional(),
    trackingNumber: z.string().trim().min(1).max(120).optional(),
    trackingUrl: trackingUrl.optional(),
    estimatedDeliveryAt: fulfillmentDate.optional(),
    evidence: fulfillmentEvidence,
  }),
  z.strictObject({
    action: z.literal('AVAILABLE_FOR_PICKUP'),
    ...fulfillmentTime,
  }),
  z.strictObject({ action: z.literal('DELIVER'), ...handover }),
  z.strictObject({ action: z.literal('PICK_UP'), ...handover }),
  z.strictObject({
    action: z.literal('DELIVERY_ATTEMPT'),
    ...fulfillmentTime,
    outcome: z.enum(['UNSUCCESSFUL', 'REFUSED', 'FAILED']),
    evidence: fulfillmentEvidence,
  }),
  z.strictObject({
    action: z.literal('REMIT_CASH'),
    ...fulfillmentTime,
    reference: fulfillmentEvidence,
  }),
  z.strictObject({ action: z.literal('COMPLETE'), ...fulfillmentTime }),
]);

const resolutionItem = z.strictObject({
  itemId: z.uuid(),
  quantity: z.number().int().min(1).max(10_000),
});
const inspectedItem = resolutionItem.extend({
  condition: z.enum(['SELLABLE', 'DAMAGED']),
});
const details = { reason: z.string().trim().min(1).max(500) };
const receiptFields = {
  ...details,
  warehouseId: z.uuid(),
  items: z.array(inspectedItem).min(1).max(50),
  evidence: fulfillmentEvidence,
};
export const resolutionItemsSchema = z.array(resolutionItem).min(1).max(50);
export const customerResolutionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('REQUEST_CANCELLATION'), ...details }),
  z.strictObject({
    action: z.literal('REQUEST_RETURN'),
    ...details,
    items: resolutionItemsSchema,
  }),
]);
export const merchantResolutionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('CANCEL'), ...details }),
  z.strictObject({ action: z.literal('REJECT_CANCELLATION'), ...details }),
  z.strictObject({
    action: z.literal('DECIDE_RETURN'),
    ...details,
    returnId: z.uuid(),
    approved: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('RECEIVE_RETURN'),
    ...receiptFields,
    returnId: z.uuid(),
  }),
  z.strictObject({ action: z.literal('WAREHOUSE_RETURN'), ...receiptFields }),
  z.strictObject({
    action: z.literal('CORRECT_SOURCING'),
    ...details,
    entryId: z.uuid(),
    quantity: z.number().int().min(1).max(10_000),
    correction: z.enum([
      'RELEASE_RESERVATION',
      'REVERSE_RECEIPT',
      'REVERSE_SECURED',
    ]),
    evidence: fulfillmentEvidence,
  }),
  z.strictObject({
    action: z.literal('CLEAR_HANDOVER_DISCREPANCY'),
    ...details,
    evidence: fulfillmentEvidence,
  }),
  z.strictObject({
    action: z.literal('RECONCILE_CASH'),
    ...details,
    evidence: fulfillmentEvidence,
    cash: handover.cash.unwrap(),
  }),
]);
export const executeSpecialRefundSchema = z.strictObject({
  refundId: z.uuid(),
  ...details,
  reference: fulfillmentEvidence.optional(),
});

export const analyticsRangeSchema = z.strictObject({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export const demandAnalyticsSchema = analyticsRangeSchema.extend(
  paginationQuerySchema.shape,
);
