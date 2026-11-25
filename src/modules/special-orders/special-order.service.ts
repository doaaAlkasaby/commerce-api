import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../config/database.js';
import { AppError } from '../../common/errors/app-error.js';
import {
  calculateSkip,
  createPagination,
} from '../../common/pagination/pagination.js';
import type {
  Prisma,
  SpecialOrderRequestStatus,
} from '../../generated/prisma/client.js';
import { readSpecialOrderSettings } from '../app-settings/special-order-settings.js';
import {
  maxAttachments,
  type AttachmentData,
} from './special-order.attachments.js';
import {
  contactPhoneSchema,
  type CreateRequest,
  type EditRequest,
  type RequestList,
  type QuotationActionState,
} from './special-order.schemas.js';

const historyLimit = 100;
const merchantRoles = ['OWNER', 'ADMIN', 'MANAGER'] as const;
const attachmentSelect = {
  id: true,
  itemId: true,
  contentType: true,
  byteSize: true,
  createdAt: true,
} satisfies Prisma.SpecialOrderAttachmentSelect;
const summarySelect = {
  id: true,
  number: true,
  status: true,
  contactPhone: true,
  notes: true,
  rejectionReason: true,
  createdAt: true,
  updatedAt: true,
  customer: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.SpecialOrderRequestSelect;
const detailSelect = {
  ...summarySelect,
  history: true,
  finalOrder: { select: { id: true } },
  items: {
    select: {
      id: true,
      name: true,
      quantity: true,
      specifications: true,
      productId: true,
      variantId: true,
    },
    orderBy: { position: 'asc' },
  },
  attachments: { select: attachmentSelect, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SpecialOrderRequestSelect;

export type Scope = { tenantId: string; customerId?: string };
export type Actor = { userId: string; tenantId: string };
type PendingAttachment = AttachmentData & { position?: number };

function formatRequest<T extends { number: number }>({
  number,
  ...request
}: T) {
  return { ...request, requestNumber: `SR-${number}` };
}

function requestMissing(): never {
  throw new AppError(
    'Special request not found',
    404,
    'SPECIAL_REQUEST_NOT_FOUND',
  );
}

export function invalidState(): never {
  throw new AppError(
    'Special request cannot be changed in its current status',
    409,
    'SPECIAL_REQUEST_STATE_CONFLICT',
  );
}

async function detail(db: Prisma.TransactionClient, scope: Scope, id: string) {
  const request = await db.specialOrderRequest.findFirst({
    where: { ...scope, id },
    select: detailSelect,
  });
  return request ? formatRequest(request) : requestMissing();
}

export async function lockRequest(
  tx: Prisma.TransactionClient,
  scope: Scope,
  id: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SpecialOrderRequest"
    WHERE id = ${id} AND "tenantId" = ${scope.tenantId}
      AND (${scope.customerId ?? null}::text IS NULL OR "customerId" = ${scope.customerId ?? null})
    FOR UPDATE
  `;
  if (!rows.length) requestMissing();
  return detail(tx, scope, id);
}

function fingerprint(input: CreateRequest, files: PendingAttachment[]) {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({
      contactPhone: input.contactPhone ?? null,
      notes: input.notes ?? null,
      items: input.items.map(
        ({ name, quantity, specifications, productId, variantId }) => [
          name,
          quantity,
          specifications ?? null,
          productId ?? null,
          variantId ?? null,
        ],
      ),
      attachments: files.map(({ content, contentType, position }) => [
        position ?? null,
        contentType,
        createHash('sha256').update(content).digest('hex'),
      ]),
    }),
  );
  return hash.digest('hex');
}

export async function resolveCatalogItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  items: Array<Pick<CreateRequest['items'][number], 'productId' | 'variantId'>>,
) {
  const variantIds = items.flatMap(({ variantId }) =>
    variantId ? [variantId] : [],
  );
  const productIds = items.flatMap(({ productId }) =>
    productId ? [productId] : [],
  );
  const variants = variantIds.length
    ? await tx.productVariant.findMany({
        where: { id: { in: variantIds }, product: { tenantId } },
        select: { id: true, productId: true, taxCategoryId: true },
      })
    : [];
  const resolvedProductIds = [
    ...new Set([...productIds, ...variants.map(({ productId }) => productId)]),
  ];
  const products = resolvedProductIds.length
    ? await tx.product.findMany({
        where: { id: { in: resolvedProductIds }, tenantId },
        select: { id: true, taxCategoryId: true },
      })
    : [];
  const byVariant = new Map(variants.map((variant) => [variant.id, variant]));
  const byProduct = new Map(products.map((product) => [product.id, product]));
  return items.map(({ productId, variantId }) => {
    const variant = variantId ? byVariant.get(variantId) : undefined;
    const resolvedProductId = productId ?? variant?.productId;
    const product = resolvedProductId
      ? byProduct.get(resolvedProductId)
      : undefined;
    if (
      (resolvedProductId && !product) ||
      (variantId && (!variant || variant.productId !== resolvedProductId))
    )
      throw new AppError(
        'Invalid catalog reference',
        400,
        'INVALID_SPECIAL_REQUEST_CATALOG_REFERENCE',
      );
    return {
      productId: product?.id ?? null,
      variantId: variant?.id ?? null,
      taxCategoryId: variant?.taxCategoryId ?? product?.taxCategoryId ?? null,
    };
  });
}

async function resolveItems(
  tx: Prisma.TransactionClient,
  tenantId: string,
  items: CreateRequest['items'],
) {
  const catalog = await resolveCatalogItems(tx, tenantId, items);
  return items.map(({ name, quantity, specifications }, position) => ({
    position,
    name,
    quantity,
    specifications: specifications ?? null,
    productId: catalog[position]!.productId,
    variantId: catalog[position]!.variantId,
  }));
}

async function defaultPhone(tx: Prisma.TransactionClient, userId: string) {
  const addresses = await tx.address.findMany({
    where: { userId, phone: { not: null } },
    orderBy: [
      { isDefaultShipping: 'desc' },
      { isDefaultBilling: 'desc' },
      { updatedAt: 'desc' },
    ],
    select: { phone: true },
  });
  for (const { phone } of addresses) {
    const result = contactPhoneSchema.safeParse(phone);
    if (result.success) return result.data;
  }
  throw new AppError(
    'A valid contact phone is required',
    400,
    'SPECIAL_REQUEST_PHONE_REQUIRED',
  );
}

const notificationMessages = {
  SPECIAL_REQUEST_CREATED: [
    'New special request',
    'A customer submitted a special request.',
  ],
  SPECIAL_REQUEST_REJECTED: [
    'Special request rejected',
    'Your special request was rejected. Open it to view the reason.',
  ],
  SPECIAL_REQUEST_RESUBMITTED: [
    'Special request resubmitted',
    'A customer updated their special request.',
  ],
  SPECIAL_QUOTATION_PUBLISHED: [
    'Special quotation available',
    'Open your special request to review the quotation.',
  ],
  SPECIAL_QUOTATION_ACCEPTED: [
    'Special quotation accepted',
    'A customer accepted your quotation.',
  ],
  SPECIAL_ORDER_DEPOSIT_VERIFIED: [
    'Special order deposit verified',
    'Your special order deposit has been verified.',
  ],
  SPECIAL_ORDER_PAYMENT_VERIFIED: [
    'Special order payment verified',
    'Your special order payment has been verified.',
  ],
  SPECIAL_ORDER_PAYMENT_FAILED: [
    'Special order payment failed',
    'Review your special order payment options.',
  ],
  SPECIAL_ORDER_SOURCING_STARTED: [
    'Special order sourcing started',
    'We have started securing your products.',
  ],
  SPECIAL_ORDER_READY: [
    'Special order products secured',
    'All products for your special order have been secured.',
  ],
  SPECIAL_ORDER_BALANCE_AVAILABLE: [
    'Special order balance available',
    'Open your special order to pay the remaining online balance.',
  ],
  SPECIAL_ORDER_DISPATCHED: [
    'Special order dispatched',
    'Your special order is on its way.',
  ],
  SPECIAL_ORDER_AWAITING_PICKUP: [
    'Special order available for pickup',
    'Your special order is available at the selected pickup location.',
  ],
  SPECIAL_ORDER_HANDED_OVER: [
    'Special order handed over',
    'Delivery or pickup of your special order has been recorded.',
  ],
  SPECIAL_ORDER_DELIVERY_FAILED: [
    'Special order delivery needs attention',
    'Open your special order to review the delivery status.',
  ],
  SPECIAL_ORDER_COMPLETED: [
    'Special order completed',
    'Fulfillment and payment for your special order are complete.',
  ],
  SPECIAL_ORDER_CANCELLED: [
    'Special order cancelled',
    'Cancellation was recorded. Check the order for refund status.',
  ],
  SPECIAL_ORDER_CANCELLATION_REJECTED: [
    'Special order cancellation reviewed',
    'The cancellation request was declined.',
  ],
  SPECIAL_ORDER_RETURN_DECIDED: [
    'Special order return reviewed',
    'Check your special order for the return decision.',
  ],
  SPECIAL_ORDER_RETURN_RECEIVED: [
    'Special order return received',
    'The return was inspected. Check the order for refund status.',
  ],
  SPECIAL_ORDER_REFUND_SETTLED: [
    'Special order refund settled',
    'A refund for your special order has been recorded.',
  ],
  SPECIAL_ORDER_CREATED: [
    'Special order created',
    'The special order was created and is pending sourcing.',
  ],
  SPECIAL_QUOTATION_REJECTED: [
    'Special quotation rejected',
    'A customer rejected your quotation.',
  ],
} as const;

export async function notify(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
  userId: string,
  eventType: keyof typeof notificationMessages,
  eventId = requestId,
) {
  const [title, body] = notificationMessages[eventType];
  await tx.notification.create({
    data: {
      tenantId,
      userId,
      eventKey: `${eventType}:${eventId}:${userId}`,
      type: 'SYSTEM',
      title,
      body,
      data: {
        eventType,
        requestId,
        ...(eventType === 'SPECIAL_ORDER_CREATED' && { orderId: eventId }),
      },
      pushJob: { create: { tenantId } },
    },
  });
}

export async function notifyMerchants(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requestId: string,
  eventType:
    | 'SPECIAL_REQUEST_CREATED'
    | 'SPECIAL_REQUEST_RESUBMITTED'
    | 'SPECIAL_QUOTATION_ACCEPTED'
    | 'SPECIAL_QUOTATION_REJECTED'
    | 'SPECIAL_ORDER_CREATED',
  eventId = requestId,
) {
  const recipients = await tx.tenantMember.findMany({
    where: {
      tenantId,
      status: 'ACTIVE',
      role: { in: [...merchantRoles] },
      user: { isActive: true },
    },
    select: { userId: true },
  });
  for (const recipient of recipients)
    await notify(tx, tenantId, requestId, recipient.userId, eventType, eventId);
}

export function appendHistory(
  history: Prisma.JsonValue,
  entry: Prisma.InputJsonObject,
) {
  const events = Array.isArray(history) ? history : [];
  return [
    ...(events.slice(-(historyLimit - 1)) as Prisma.InputJsonArray),
    entry,
  ];
}

export async function createRequest(
  { tenantId, userId }: Actor,
  key: string,
  input: CreateRequest,
  files: PendingAttachment[],
) {
  const requestFingerprint = fingerprint(input, files);
  const scope = { tenantId, customerId: userId };
  return prisma.$transaction(async (tx) => {
    // Serialize allocation and replay per tenant without touching regular order numbering.
    const locked = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "Tenant" WHERE id = ${tenantId} AND status = 'ACTIVE' FOR UPDATE`;
    if (!locked.length) requestMissing();
    const previous = await tx.specialOrderRequest.findUnique({
      where: {
        tenantId_customerId_idempotencyKey: { ...scope, idempotencyKey: key },
      },
      select: { id: true, requestFingerprint: true },
    });
    if (previous) {
      if (previous.requestFingerprint !== requestFingerprint)
        throw new AppError(
          'Idempotency key is already in use',
          409,
          'IDEMPOTENCY_KEY_CONFLICT',
        );
      return { request: await detail(tx, scope, previous.id), replayed: true };
    }
    const setting = await tx.appSetting.findUnique({
      where: { tenantId_key: { tenantId, key: 'special_orders' } },
      select: { value: true, isPublic: true },
    });
    if (!setting?.isPublic || !readSpecialOrderSettings(setting.value).enabled)
      throw new AppError(
        'Special requests are disabled',
        403,
        'SPECIAL_ORDERS_DISABLED',
      );
    const items = await resolveItems(tx, tenantId, input.items);
    const contactPhone = input.contactPhone ?? (await defaultPhone(tx, userId));
    const latest = await tx.specialOrderRequest.findFirst({
      where: { tenantId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const request = await tx.specialOrderRequest.create({
      data: {
        ...scope,
        number: (latest?.number ?? 1000) + 1,
        contactPhone,
        notes: input.notes ?? null,
        requestFingerprint,
        idempotencyKey: key,
        items: { create: items },
        history: [
          { action: 'CREATED', actorId: userId, at: new Date().toISOString() },
        ],
      },
      select: { id: true, items: { select: { id: true, position: true } } },
    });
    if (files.length) {
      const ids = new Map(
        request.items.map(({ id, position }) => [position, id]),
      );
      await tx.specialOrderAttachment.createMany({
        data: files.map(({ position, ...file }) => ({
          ...file,
          requestId: request.id,
          itemId: position === undefined ? null : ids.get(position)!,
        })),
      });
    }
    await notifyMerchants(tx, tenantId, request.id, 'SPECIAL_REQUEST_CREATED');
    return { request: await detail(tx, scope, request.id), replayed: false };
  });
}

export async function listRequests(
  scope: Scope,
  { page, limit, status, search }: RequestList,
) {
  const numberSearch =
    search && /^SR-\d+$/i.test(search) ? Number(search.slice(3)) : undefined;
  const where: Prisma.SpecialOrderRequestWhereInput = {
    ...scope,
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            ...(numberSearch !== undefined && numberSearch <= 2147483647
              ? [{ number: numberSearch }]
              : []),
            { contactPhone: { contains: search } },
            {
              customer: {
                OR: [
                  {
                    firstName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                  {
                    lastName: {
                      contains: search,
                      mode: 'insensitive' as const,
                    },
                  },
                ],
              },
            },
            {
              items: {
                some: {
                  name: { contains: search, mode: 'insensitive' as const },
                },
              },
            },
          ],
        }
      : {}),
  };
  const [requests, total] = await prisma.$transaction([
    prisma.specialOrderRequest.findMany({
      where,
      select: summarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: calculateSkip(page, limit),
      take: limit,
    }),
    prisma.specialOrderRequest.count({ where }),
  ]);
  return {
    items: requests.map(formatRequest),
    pagination: createPagination(page, limit, total),
  };
}

export const getRequest = (scope: Scope, id: string) =>
  detail(prisma, scope, id);

async function assertQuotationAction(
  tx: Prisma.TransactionClient,
  requestId: string,
  status: SpecialOrderRequestStatus,
  expected: QuotationActionState | undefined,
) {
  const quote = await tx.specialOrderQuotation.findUnique({
    where: { requestId_isDraft: { requestId, isDraft: false } },
    select: { id: true, version: true },
  });
  if (
    !expected ||
    !quote ||
    status !== expected.status ||
    quote.id !== expected.quotationId ||
    quote.version !== expected.version
  )
    throw new AppError(
      'The quotation has changed',
      409,
      'SPECIAL_QUOTATION_CONFLICT',
    );
}

export async function editRequest(
  { tenantId, userId }: Actor,
  id: string,
  input: EditRequest,
  files: PendingAttachment[] = [],
) {
  const scope = { tenantId, customerId: userId };
  return prisma.$transaction(async (tx) => {
    const old = await lockRequest(tx, scope, id);
    const resubmitted = old.status === 'QUOTED' || old.status === 'ACCEPTED';
    if (old.status !== 'NEW' && !resubmitted) invalidState();
    if (resubmitted) {
      await assertQuotationAction(tx, id, old.status, input.resubmit);
      await tx.specialOrderQuotation.deleteMany({ where: { requestId: id } });
    } else if (input.resubmit) {
      invalidState();
    }
    const retained = input.items.flatMap((item) => (item.id ? [item.id] : []));
    if (
      new Set(retained).size !== retained.length ||
      retained.some((itemId) => !old.items.some((item) => item.id === itemId))
    )
      throw new AppError(
        'Invalid request item',
        400,
        'INVALID_SPECIAL_REQUEST_ITEM',
      );
    const items = await resolveItems(tx, tenantId, input.items);
    await tx.specialOrderRequestItem.deleteMany({
      where: { requestId: id, id: { notIn: retained } },
    });
    for (const [index, item] of items.entries()) {
      const itemId = input.items[index]?.id;
      if (itemId)
        await tx.specialOrderRequestItem.update({
          where: { requestId_id: { id: itemId, requestId: id } },
          data: item,
        });
      else
        await tx.specialOrderRequestItem.create({
          data: { ...item, requestId: id },
        });
    }
    if (
      input.removeAttachmentIds?.some(
        (attachmentId) =>
          !old.attachments.some((file) => file.id === attachmentId),
      )
    )
      throw new AppError(
        'Invalid attachment reference',
        400,
        'INVALID_ATTACHMENT',
      );
    if (input.removeAttachmentIds?.length)
      await tx.specialOrderAttachment.deleteMany({
        where: { requestId: id, id: { in: input.removeAttachmentIds } },
      });
    if (files.length) {
      const remaining = await tx.specialOrderAttachment.count({
        where: { requestId: id },
      });
      if (remaining + files.length > maxAttachments)
        throw new AppError(
          'Attachment limit reached',
          400,
          'SPECIAL_REQUEST_ATTACHMENT_LIMIT',
        );
      const positions = await tx.specialOrderRequestItem.findMany({
        where: { requestId: id },
        select: { id: true, position: true },
      });
      await tx.specialOrderAttachment.createMany({
        data: files.map(({ position, ...file }) => ({
          ...file,
          requestId: id,
          itemId:
            position === undefined
              ? null
              : positions.find((item) => item.position === position)!.id,
        })),
      });
    }
    await tx.specialOrderRequest.update({
      where: { id },
      data: {
        status: 'NEW',
        contactPhone: input.contactPhone ?? old.contactPhone,
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        history: appendHistory(old.history, {
          action: resubmitted ? 'RESUBMITTED' : 'EDITED',
          actorId: userId,
          at: new Date().toISOString(),
        }),
      },
    });
    if (resubmitted)
      await notifyMerchants(
        tx,
        tenantId,
        id,
        'SPECIAL_REQUEST_RESUBMITTED',
        randomUUID(),
      );
    return detail(tx, scope, id);
  });
}

export async function transitionRequest(
  { tenantId, userId }: Actor,
  id: string,
  status: Extract<
    SpecialOrderRequestStatus,
    'CANCELLED' | 'UNDER_REVIEW' | 'REJECTED'
  >,
  reason?: string,
  expectedQuotation?: QuotationActionState,
) {
  const scope =
    status === 'CANCELLED' ? { tenantId, customerId: userId } : { tenantId };
  return prisma.$transaction(async (tx) => {
    const old = await lockRequest(tx, scope, id);
    if (old.status === status) {
      if (status === 'REJECTED' && old.rejectionReason !== reason)
        invalidState();
      return old;
    }
    const allowed =
      status === 'UNDER_REVIEW'
        ? old.status === 'NEW'
        : old.status === 'NEW' ||
          old.status === 'UNDER_REVIEW' ||
          old.status === 'QUOTED' ||
          (status === 'CANCELLED' && old.status === 'ACCEPTED');

    if (!allowed) invalidState();
    if (status === 'CANCELLED') {
      if (old.status === 'QUOTED' || old.status === 'ACCEPTED')
        await assertQuotationAction(tx, id, old.status, expectedQuotation);
      else if (expectedQuotation) invalidState();
    }
    if (status !== 'UNDER_REVIEW')
      await tx.specialOrderQuotation.deleteMany({ where: { requestId: id } });

    await tx.specialOrderRequest.update({
      where: { id },
      data: {
        status,
        rejectionReason: reason ?? null,
        history: appendHistory(old.history, {
          action: status,
          actorId: userId,
          at: new Date().toISOString(),
          from: old.status,
        }),
      },
    });
    if (status === 'REJECTED')
      await notify(
        tx,
        tenantId,
        id,
        old.customer.id,
        'SPECIAL_REQUEST_REJECTED',
      );
    return detail(tx, scope, id);
  });
}

export async function addAttachment(
  scope: Required<Scope>,
  id: string,
  itemId: string | undefined,
  file: AttachmentData,
) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, scope, id);
    if (request.status !== 'NEW') invalidState();
    if (request.attachments.length >= maxAttachments)
      throw new AppError(
        'Attachment limit reached',
        400,
        'SPECIAL_REQUEST_ATTACHMENT_LIMIT',
      );
    if (itemId && !request.items.some((item) => item.id === itemId))
      throw new AppError(
        'Invalid request item',
        400,
        'INVALID_SPECIAL_REQUEST_ITEM',
      );
    return tx.specialOrderAttachment.create({
      data: { ...file, requestId: id, itemId: itemId ?? null },
      select: attachmentSelect,
    });
  });
}

export async function getAttachment(
  scope: Scope,
  requestId: string,
  attachmentId: string,
) {
  const attachment = await prisma.specialOrderAttachment.findFirst({
    where: { id: attachmentId, requestId, request: scope },
    select: { id: true, content: true, contentType: true },
  });
  return attachment ?? requestMissing();
}
