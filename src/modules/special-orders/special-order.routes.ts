import * as analytics from './special-order-analytics.service.js';
import { sensitiveRateLimiter } from '../../config/rate-limit.js';
import { Router, type Request, type Response } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { sendSuccess } from '../../common/responses/api-response.js';
import { validate } from '../../common/validation/validate.js';
import { authenticate } from '../../middleware/auth.middleware.js';
import { tenantMemberMiddleware } from '../../middleware/tenant-member.middleware.js';
import { requireTenantRoles } from '../../middleware/tenant-role.middleware.js';
import { tenantMiddleware } from '../../middleware/tenant.middleware.js';
import {
  attachmentData,
  downloadFilename,
  requestUpload,
} from './special-order.attachments.js';
import {
  attachmentInputSchema,
  checkoutPreviewSchema,
  checkoutConfirmSchema,
  checkoutOptionsSchema,
  specialOrderListSchema,
  specialAttemptParams,
  sourcingActionSchema,
  analyticsRangeSchema,
  demandAnalyticsSchema,
  fulfillmentActionSchema,
  customerResolutionSchema,
  merchantResolutionSchema,
  executeSpecialRefundSchema,
  specialPaymentInitiationSchema,
  specialPaymentVerificationSchema,
  attachmentParamsSchema,
  createRequestSchema,
  editRequestSchema,
  idempotencyKeySchema,
  merchantListSchema,
  rejectRequestSchema,
  requestIdSchema,
  requestListSchema,
  quotationCancelSchema,
  quotationDraftSchema,
  quotationVersionSchema,
  quotationSelectionSchema,
  customerQuotationRejectionSchema,
  quotationImageParamsSchema,
} from './special-order.schemas.js';
import * as checkout from './special-checkout.service.js';
import * as resolution from './special-order-resolution.service.js';
import { executeSpecialRefund } from './special-order-refunds.service.js';
import * as fulfillment from './special-order-fulfillment.service.js';
import * as sourcing from './special-order-sourcing.service.js';
import * as payments from './special-order-payments.service.js';
import * as orders from './special-orders-read.service.js';
import * as quotations from './special-order-quotation.service.js';
import * as requests from './special-order.service.js';

const router = Router();
router.use(
  tenantMiddleware,
  authenticate,
  tenantMemberMiddleware,
  (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  },
);

const actor = (req: Request) => ({
  tenantId: req.tenant!.tenantId,
  userId: req.user!.userId,
});
const customerScope = (req: Request) => ({
  tenantId: req.tenant!.tenantId,
  customerId: req.user!.userId,
});
const merchantScope = (req: Request) => ({ tenantId: req.tenant!.tenantId });

router.get(
  '/analytics/overview',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(analyticsRangeSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await analytics.operationalAnalytics(
        actor(req).tenantId,
        analyticsRangeSchema.parse(req.query),
      ),
    ),
);
router.get(
  '/analytics/demand',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(demandAnalyticsSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await analytics.productDemandAnalytics(
        actor(req).tenantId,
        demandAnalyticsSchema.parse(req.query),
      ),
    ),
);
router.get(
  '/analytics/financial',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(analyticsRangeSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await analytics.financialAnalytics(
        actor(req).tenantId,
        analyticsRangeSchema.parse(req.query),
      ),
    ),
);

router.get(
  '/my/orders/:id/resolution',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await resolution.getResolutions(
        customerScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);
router.post(
  '/my/orders/:id/resolution',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  validate(customerResolutionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await resolution.resolveOrder(
        actor(req),
        requestIdSchema.parse(req.params).id,
        idempotencyKeySchema.parse(req.header('Idempotency-Key')),
        customerResolutionSchema.parse(req.body),
        false,
      ),
    ),
);
router.get(
  '/orders/:id/resolution',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await resolution.getResolutions(
        merchantScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);
router.post(
  '/orders/:id/resolution',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  validate(merchantResolutionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await resolution.resolveOrder(
        actor(req),
        requestIdSchema.parse(req.params).id,
        idempotencyKeySchema.parse(req.header('Idempotency-Key')),
        merchantResolutionSchema.parse(req.body),
        true,
      ),
    ),
);
router.post(
  '/orders/:id/refunds',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  validate(executeSpecialRefundSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await executeSpecialRefund(
        actor(req),
        requestIdSchema.parse(req.params).id,
        idempotencyKeySchema.parse(req.header('Idempotency-Key')),
        executeSpecialRefundSchema.parse(req.body),
      ),
    ),
);

router.get(
  '/orders/:id/fulfillment',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await fulfillment.getFulfillment(
        merchantScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.post(
  '/orders/:id/fulfillment',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  validate(fulfillmentActionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await fulfillment.fulfillOrder(
        actor(req),
        requestIdSchema.parse(req.params).id,
        idempotencyKeySchema.parse(req.header('Idempotency-Key')),
        fulfillmentActionSchema.parse(req.body),
      ),
    ),
);

router.get(
  '/orders/:id/sourcing',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await sourcing.getSourcing(
        merchantScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.post(
  '/orders/:id/sourcing',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  validate(sourcingActionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await sourcing.sourceOrder(
        actor(req),
        requestIdSchema.parse(req.params).id,
        idempotencyKeySchema.parse(req.header('Idempotency-Key')),
        sourcingActionSchema.parse(req.body),
      ),
    ),
);

router.get(
  '/my/orders/:id/payment',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await payments.getPaymentDetails(
        customerScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.get(
  '/my/orders/:id/payment/options',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) => {
    const { obligations } = await payments.getPaymentDetails(
      customerScope(req),
      requestIdSchema.parse(req.params).id,
    );
    return sendSuccess(res, { obligations });
  },
);

router.post(
  '/my/orders/:id/payment/attempts',
  requireTenantRoles('CUSTOMER'),
  sensitiveRateLimiter,
  validate(requestIdSchema, 'params'),
  validate(specialPaymentInitiationSchema, 'body'),
  async (req, res) => {
    const key = idempotencyKeySchema.parse(req.header('Idempotency-Key'));
    const { obligationId } = specialPaymentInitiationSchema.parse(req.body);
    const result = await payments.initiateSpecialPayment(
      customerScope(req),
      requestIdSchema.parse(req.params).id,
      obligationId,
      key,
    );
    return sendSuccess(
      res,
      result.attempt,
      undefined,
      result.replayed ? 200 : 201,
    );
  },
);

router.get(
  '/my/orders/:id/payment/attempts/:attemptId',
  requireTenantRoles('CUSTOMER'),
  validate(specialAttemptParams, 'params'),
  async (req, res) => {
    const { id, attemptId } = specialAttemptParams.parse(req.params);
    return sendSuccess(
      res,
      await payments.getSpecialAttempt(customerScope(req), id, attemptId),
    );
  },
);

router.post(
  '/my/orders/:id/payment/attempts/:attemptId/verify',
  requireTenantRoles('CUSTOMER'),
  sensitiveRateLimiter,
  validate(specialAttemptParams, 'params'),
  validate(specialPaymentVerificationSchema, 'body'),
  async (req, res) => {
    const { id, attemptId } = specialAttemptParams.parse(req.params);
    return sendSuccess(
      res,
      await payments.verifySpecialPayment(customerScope(req), id, attemptId),
    );
  },
);

router.get(
  '/orders/:id/payment',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await payments.getPaymentDetails(
        merchantScope(req),
        requestIdSchema.parse(req.params).id,
        true,
      ),
    ),
);

router.get(
  '/my/orders',
  requireTenantRoles('CUSTOMER'),
  validate(requestListSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await orders.listOrders(
        customerScope(req),
        requestListSchema.parse(req.query),
      ),
    ),
);

router.get(
  '/my/orders/:id',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await orders.getOrder(
        customerScope(req),
        requestIdSchema.parse(req.params),
      ),
    ),
);

router.get(
  '/orders',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(specialOrderListSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await orders.listOrders(
        merchantScope(req),
        specialOrderListSchema.parse(req.query),
      ),
    ),
);

router.get(
  '/orders/:id',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await orders.getOrder(
        merchantScope(req),
        requestIdSchema.parse(req.params),
      ),
    ),
);

router.get(
  '/my/:id/order',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await orders.getOrder(customerScope(req), {
        requestId: requestIdSchema.parse(req.params).id,
      }),
    ),
);

router.get(
  '/my/:id/checkout',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await checkout.getCheckout(
        actor(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.get(
  '/my/:id/checkout/options',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  validate(checkoutOptionsSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await checkout.getCheckoutOptions(
        actor(req),
        requestIdSchema.parse(req.params).id,
        checkoutOptionsSchema.parse(req.query).addressId,
      ),
    ),
);

router.post(
  '/my/:id/checkout/preview',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  validate(checkoutPreviewSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await checkout.previewCheckout(
        actor(req),
        requestIdSchema.parse(req.params).id,
        checkoutPreviewSchema.parse(req.body),
      ),
    ),
);

router.post(
  '/my/:id/checkout/confirm',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  validate(checkoutConfirmSchema, 'body'),
  async (req, res) => {
    const key = idempotencyKeySchema.parse(req.header('Idempotency-Key'));
    const result = await checkout.confirmCheckout(
      actor(req),
      requestIdSchema.parse(req.params).id,
      key,
      checkoutConfirmSchema.parse(req.body),
    );
    return sendSuccess(
      res,
      result.order,
      result.replayed
        ? 'Special order already created'
        : 'Special order created',
      result.replayed ? 200 : 201,
    );
  },
);

function submissionBody(req: Request): unknown {
  if (!req.is('multipart/form-data')) return req.body;
  if (typeof req.body?.request !== 'string')
    throw new AppError(
      'Multipart submission requires a request JSON field',
      400,
      'VALIDATION_ERROR',
    );
  try {
    return JSON.parse(req.body.request);
  } catch {
    throw new AppError('Invalid request JSON', 400, 'VALIDATION_ERROR');
  }
}

function submissionFiles(req: Request, itemCount: number) {
  return (Array.isArray(req.files) ? req.files : []).map((file) => {
    if (file.fieldname === 'attachment') return attachmentData(file, false);
    const match = /^itemImage-(0|[1-9][0-9]?)$/.exec(file.fieldname);
    const position = Number(match?.[1]);
    if (!match || position >= itemCount)
      throw new AppError(
        'Invalid attachment item position',
        400,
        'INVALID_SPECIAL_REQUEST_ITEM',
      );
    return { ...attachmentData(file, true), position };
  });
}

router.post(
  '/my',
  requireTenantRoles('CUSTOMER'),
  requestUpload.any(),
  async (req, res) => {
    const input = createRequestSchema.parse(submissionBody(req));
    const key = idempotencyKeySchema.parse(req.header('Idempotency-Key'));
    const files = submissionFiles(req, input.items.length);
    const result = await requests.createRequest(actor(req), key, input, files);
    return sendSuccess(
      res,
      result.request,
      result.replayed
        ? 'Special request already submitted'
        : 'Special request submitted',
      result.replayed ? 200 : 201,
    );
  },
);

router.get(
  '/my',
  requireTenantRoles('CUSTOMER'),
  validate(requestListSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await requests.listRequests(
        customerScope(req),
        requestListSchema.parse(req.query),
      ),
    ),
);

router.get(
  '/my/:id',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await requests.getRequest(
        customerScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.patch(
  '/my/:id',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  requestUpload.any(),
  async (req, res) => {
    const input = editRequestSchema.parse(submissionBody(req));
    return sendSuccess(
      res,
      await requests.editRequest(
        actor(req),
        requestIdSchema.parse(req.params).id,
        input,
        submissionFiles(req, input.items.length),
      ),
    );
  },
);

router.post(
  '/my/:id/cancel',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await requests.transitionRequest(
        actor(req),
        requestIdSchema.parse(req.params).id,
        'CANCELLED',
        undefined,
        quotationCancelSchema.parse(req.body),
      ),
    ),
);

router.post(
  '/my/:id/attachments',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  requestUpload.single('file'),
  async (req, res) => {
    const { itemId } = attachmentInputSchema.parse(req.body ?? {});
    if (!req.file)
      throw new AppError(
        'An attachment file is required',
        400,
        'INVALID_ATTACHMENT',
      );
    const result = await requests.addAttachment(
      customerScope(req),
      requestIdSchema.parse(req.params).id,
      itemId,
      attachmentData(req.file, Boolean(itemId)),
    );
    return sendSuccess(res, result, 'Attachment uploaded', 201);
  },
);

async function download(
  req: Request,
  res: Response,
  scope: ReturnType<typeof merchantScope>,
) {
  const { id, attachmentId } = attachmentParamsSchema.parse(req.params);
  const file = await requests.getAttachment(scope, id, attachmentId);
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${downloadFilename(file.id, file.contentType)}"`,
  });
  return res.send(Buffer.from(file.content));
}

router.get(
  '/my/:id/attachments/:attachmentId',
  requireTenantRoles('CUSTOMER'),
  validate(attachmentParamsSchema, 'params'),
  (req, res) => download(req, res, customerScope(req)),
);

router.get(
  '/',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(merchantListSchema, 'query'),
  async (req, res) =>
    sendSuccess(
      res,
      await requests.listRequests(
        merchantScope(req),
        merchantListSchema.parse(req.query),
      ),
    ),
);

router.get(
  '/:id',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await requests.getRequest(
        merchantScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.post(
  '/:id/review',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await requests.transitionRequest(
        actor(req),
        requestIdSchema.parse(req.params).id,
        'UNDER_REVIEW',
      ),
    ),
);

router.post(
  '/:id/reject',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  validate(rejectRequestSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await requests.transitionRequest(
        actor(req),
        requestIdSchema.parse(req.params).id,
        'REJECTED',
        rejectRequestSchema.parse(req.body).reason,
      ),
    ),
);

router.get(
  '/:id/attachments/:attachmentId',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(attachmentParamsSchema, 'params'),
  (req, res) => download(req, res, merchantScope(req)),
);

router.get(
  '/my/:id/quotation',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await quotations.getQuotations(
        customerScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.post(
  '/my/:id/quotation/calculate',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  validate(quotationSelectionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await quotations.calculateSelection(
        actor(req),
        requestIdSchema.parse(req.params).id,
        quotationSelectionSchema.parse(req.body),
      ),
    ),
);

router.post(
  '/my/:id/quotation/accept',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  validate(quotationSelectionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await quotations.accept(
        actor(req),
        requestIdSchema.parse(req.params).id,
        quotationSelectionSchema.parse(req.body),
      ),
    ),
);

router.post(
  '/my/:id/quotation/reject',
  requireTenantRoles('CUSTOMER'),
  validate(requestIdSchema, 'params'),
  validate(customerQuotationRejectionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await quotations.reject(
        actor(req),
        requestIdSchema.parse(req.params).id,
        customerQuotationRejectionSchema.parse(req.body),
      ),
    ),
);

router.get(
  '/:id/quotation',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  async (req, res) =>
    sendSuccess(
      res,
      await quotations.getQuotations(
        merchantScope(req),
        requestIdSchema.parse(req.params).id,
      ),
    ),
);

router.put(
  '/:id/quotation/draft',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  requestUpload.any(),
  async (req, res) => {
    const input = quotationDraftSchema.parse(submissionBody(req));
    const images = new Map<number, ReturnType<typeof attachmentData>>();
    for (const file of Array.isArray(req.files) ? req.files : []) {
      const match = /^itemImage-(0|[1-9][0-9]?)$/.exec(file.fieldname);
      const position = Number(match?.[1]);
      if (!match || position >= input.items.length || images.has(position))
        throw new AppError(
          'Invalid quotation image position',
          400,
          'INVALID_ATTACHMENT',
        );
      images.set(position, attachmentData(file, true));
    }
    return sendSuccess(
      res,
      await quotations.saveDraft(
        actor(req),
        requestIdSchema.parse(req.params).id,
        input,
        images,
      ),
    );
  },
);

router.post(
  '/:id/quotation/publish',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(requestIdSchema, 'params'),
  validate(quotationVersionSchema, 'body'),
  async (req, res) =>
    sendSuccess(
      res,
      await quotations.publish(
        actor(req),
        requestIdSchema.parse(req.params).id,
        quotationVersionSchema.parse(req.body),
      ),
    ),
);

async function downloadQuotationImage(
  req: Request,
  res: Response,
  scope: ReturnType<typeof merchantScope>,
) {
  const { id, quotationId, itemId } = quotationImageParamsSchema.parse(
    req.params,
  );
  const file = await quotations.getImage(scope, id, quotationId, itemId);
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Content-Type': file.contentType,
    'Content-Disposition': `attachment; filename="${downloadFilename(itemId, file.contentType)}"`,
  });
  return res.send(Buffer.from(file.content));
}

router.get(
  '/my/:id/quotation/:quotationId/items/:itemId/image',
  requireTenantRoles('CUSTOMER'),
  validate(quotationImageParamsSchema, 'params'),
  (req, res) => downloadQuotationImage(req, res, customerScope(req)),
);

router.get(
  '/:id/quotation/:quotationId/items/:itemId/image',
  requireTenantRoles('OWNER', 'ADMIN', 'MANAGER'),
  validate(quotationImageParamsSchema, 'params'),
  (req, res) => downloadQuotationImage(req, res, merchantScope(req)),
);

export default router;
