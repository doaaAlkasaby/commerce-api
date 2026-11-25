import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import {
  calculateSkip,
  createPagination,
} from '../../common/pagination/pagination.js';
import { currencyPrecision } from '../../common/pricing/currency.js';
import { prisma } from '../../config/database.js';
import type { Prisma, SpecialOrder } from '../../generated/prisma/client.js';
import type { specialOrderListSchema } from './special-order.schemas.js';
import {
  financialRelations,
  financialSummary,
} from './special-order-financial-summary.js';
import {
  specialOrderMarket,
  specialProviderAccount,
} from './special-order-provider.js';
import {
  sourcingRelations,
  sourcingProgress,
} from './special-order-sourcing.service.js';
import {
  fulfillmentRelations,
  fulfillmentProgress,
} from './special-order-fulfillment.service.js';
import {
  resolutionRelations,
  presentResolutions,
} from './special-order-resolution.service.js';
import type { Scope } from './special-order.service.js';

export const orderDetail = {
  ...financialRelations,
  ...sourcingRelations,
  ...fulfillmentRelations,
  ...resolutionRelations,
} satisfies Prisma.SpecialOrderInclude;

export function presentOrder(
  order: SpecialOrder &
    Partial<Prisma.SpecialOrderGetPayload<{ include: typeof orderDetail }>>,
  merchant = false,
) {
  const precision = currencyPrecision(order.currency);
  const money = (value: Prisma.Decimal) => value.toFixed(precision);
  const paymentSummary = order.paymentObligations
    ? financialSummary({
        ...order,
        paymentObligations: order.paymentObligations,
        refunds: order.refunds ?? [],
      })
    : undefined;
  return {
    id: order.id,
    requestId: order.requestId,
    requestNumber: `SR-${order.number}`,
    acceptanceId: order.acceptanceId,
    orderNumber: `SO-${order.number}`,
    state: order.state,
    paymentStatus: paymentSummary?.status ?? order.paymentStatus,
    ...(paymentSummary && { paymentSummary }),
    customer: {
      firstName: order.customerFirstName,
      lastName: order.customerLastName,
      email: order.customerEmail,
      phone: order.customerPhone,
    },
    currency: order.currency,
    fulfillmentMethod: order.fulfillmentMethod,
    deliveryAddress: order.deliveryAddress,
    pickupLocation: order.pickupLocation,
    shippingMethod: order.shippingMethod,
    financials: order.financials,
    paymentTerms: order.paymentTerms,
    initialPayment: money(order.initialPayment),
    remainingBalance: money(order.remainingBalance),
    estimatedSourcingDays: order.sourcingDays,
    commercialTerms: order.commercialTerms,
    createdAt: order.createdAt,
    ...(order.items &&
      order.paymentObligations && {
        sourcing: sourcingProgress(
          {
            ...order,
            warehouse: order.warehouse ?? null,
            items: order.items,
            paymentObligations: order.paymentObligations,
            refunds: order.refunds ?? [],
          },
          merchant,
        ),
      }),
    ...(order.returns &&
      order.resolutionEvents &&
      order.refunds && {
        resolution: presentResolutions(
          {
            cancellationStatus: order.cancellationStatus,
            returns: order.returns,
            resolutionEvents: order.resolutionEvents,
            refunds: order.refunds,
          },
          merchant,
        ),
      }),
    ...(order.fulfillmentEvents && {
      fulfillment: fulfillmentProgress(
        order,
        order.fulfillmentEvents,
        merchant,
      ),
    }),
    ...(order.items && {
      items: order.items.map(
        ({ orderId, position, sourcingEntries, ...item }) => ({
          ...item,
          unitPrice: money(item.unitPrice),
          subtotalBeforeTax: money(item.subtotalBeforeTax),
          taxAmount: money(item.taxAmount),
          totalIncludingTax: money(item.totalIncludingTax),
        }),
      ),
    }),
  };
}

export async function getOrder(
  scope: Scope,
  identity: { id: string } | { requestId: string },
) {
  const order = await prisma.specialOrder.findFirst({
    where: { ...scope, ...identity },
    include: orderDetail,
  });
  if (!order)
    throw new AppError(
      'Special order not found',
      404,
      'SPECIAL_ORDER_NOT_FOUND',
    );
  const result = presentOrder(order, scope.customerId === undefined);
  if (result.paymentSummary?.furtherPaymentAllowed) {
    result.paymentSummary.furtherPaymentAllowed = Boolean(
      await specialProviderAccount(
        prisma,
        order.tenantId,
        specialOrderMarket(order.commercialTerms),
        order.currency,
      ),
    );
  }
  return result;
}

export async function listOrders(
  scope: Scope,
  query: z.infer<typeof specialOrderListSchema>,
) {
  const { page, limit, search, state } = query;
  const number =
    search && /^SO-\d+$/i.test(search) ? Number(search.slice(3)) : undefined;
  const where: Prisma.SpecialOrderWhereInput = {
    ...scope,
    ...(state && { state }),
    ...(search && {
      OR: [
        ...(number !== undefined && number <= 2147483647 ? [{ number }] : []),
        { customerFirstName: { contains: search, mode: 'insensitive' } },
        { customerLastName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search } },
      ],
    }),
  };
  const [orders, total] = await prisma.$transaction([
    prisma.specialOrder.findMany({
      where,
      include: financialRelations,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: calculateSkip(page, limit),
      take: limit,
    }),
    prisma.specialOrder.count({ where }),
  ]);
  return {
    items: orders.map((order) => presentOrder(order)),
    pagination: createPagination(page, limit, total),
  };
}
