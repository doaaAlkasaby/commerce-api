import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { parseDecimal } from '../../common/pricing/money.js';
import { prisma } from '../../config/database.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  SpecialOrder,
  SpecialOrderFulfillmentEvent,
} from '../../generated/prisma/client.js';
import { InventoryRepository } from '../inventory/inventory.repository.js';
import {
  financialRelations,
  financialSummary,
  paymentPosition,
} from './special-order-financial-summary.js';
import {
  sourcingRelations,
  netSourcingQuantity,
  validateFulfillmentWarehouse,
} from './special-order-sourcing.service.js';
import { notify, type Actor, type Scope } from './special-order.service.js';
import type { fulfillmentActionSchema } from './special-order.schemas.js';

type Input = z.infer<typeof fulfillmentActionSchema>;
type Tx = Prisma.TransactionClient;
export const fulfillmentRelations = {
  fulfillmentEvents: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SpecialOrderInclude;
const relations = {
  ...financialRelations,
  ...fulfillmentRelations,
  returns: {
    where: { warehouseReturn: true, status: 'RECEIVED' },
    select: { id: true },
  },
  items: {
    ...sourcingRelations.items,
    include: { sourcingEntries: { include: { corrections: true } } },
  },
} satisfies Prisma.SpecialOrderInclude;
type Order = Prisma.SpecialOrderGetPayload<{ include: typeof relations }>;

function conflict(code: string, message: string): never {
  throw new AppError(message, 409, code);
}

function missing(): never {
  throw new AppError('Special order not found', 404, 'SPECIAL_ORDER_NOT_FOUND');
}

function inventoryConflict(): never {
  return conflict(
    'SPECIAL_RESERVATION_INVALID',
    'The order does not have exclusive stock evidence for every selected item',
  );
}

function eventFor(
  events: SpecialOrderFulfillmentEvent[],
  action: Input['action'],
) {
  return [...events].reverse().find((event) => event.action === action);
}

export function fulfillmentProgress(
  order: Pick<SpecialOrder, 'state' | 'completedAt' | 'fulfillmentDiscrepancy'>,
  events: SpecialOrderFulfillmentEvent[],
  merchant: boolean,
) {
  const dispatch = eventFor(events, 'DISPATCH');
  const dispatchData = dispatch?.evidence as
    Partial<Extract<Input, { action: 'DISPATCH' }>> | undefined;
  const attempt = eventFor(events, 'DELIVERY_ATTEMPT');
  const outcome = (
    attempt?.evidence as
      Partial<Extract<Input, { action: 'DELIVERY_ATTEMPT' }>> | undefined
  )?.outcome;
  return {
    state: order.state,
    deliveryMethod: dispatchData?.deliveryMethod ?? null,
    carrierName: dispatchData?.carrierName ?? null,
    trackingNumber: dispatchData?.trackingNumber ?? null,
    trackingUrl: dispatchData?.trackingUrl ?? null,
    estimatedDeliveryAt: dispatchData?.estimatedDeliveryAt ?? null,
    dispatchedAt: dispatch?.occurredAt ?? null,
    availableForPickupAt:
      eventFor(events, 'AVAILABLE_FOR_PICKUP')?.occurredAt ?? null,
    handedOverAt:
      (order.state === 'DELIVERED'
        ? eventFor(events, 'DELIVER')
        : order.state === 'PICKED_UP'
          ? eventFor(events, 'PICK_UP')
          : undefined
      )?.occurredAt ?? null,
    lastDeliveryAttempt:
      attempt && order.state === 'SHIPPED'
        ? { outcome, occurredAt: attempt.occurredAt }
        : null,
    completedAt: order.completedAt,
    requiresReview: order.fulfillmentDiscrepancy !== null,
    ...(merchant && { discrepancy: order.fulfillmentDiscrepancy, events }),
  };
}

async function load(tx: Tx, scope: Scope, id: string) {
  return (
    (await tx.specialOrder.findFirst({
      where: { ...scope, id },
      include: relations,
    })) ?? missing()
  );
}

function result(order: Order, merchant: boolean) {
  return {
    ...fulfillmentProgress(order, order.fulfillmentEvents, merchant),
    paymentSummary: financialSummary(order),
  };
}

export async function getFulfillment(scope: Scope, id: string) {
  return result(await load(prisma, scope, id), scope.customerId === undefined);
}

async function reservationGroups(tx: Tx, order: Order) {
  if (!order.warehouseId || !order.items.length) inventoryConflict();
  const grouped = new Map<string, { quantity: number; variantId: string }>();
  for (const item of order.items) {
    const usesInventory = Boolean(item.productId || item.variantId);
    const quantity = item.sourcingEntries.reduce(
      (total, entry) => total + netSourcingQuantity(entry),
      0,
    );
    if (
      quantity !== item.quantity ||
      item.sourcingEntries.some(
        ({ inventoryId }) => Boolean(inventoryId) !== usesInventory,
      )
    )
      inventoryConflict();
    for (const entry of item.sourcingEntries) {
      if (!entry.inventoryId || netSourcingQuantity(entry) === 0) continue;
      const row = await tx.inventory.findFirst({
        where: {
          id: entry.inventoryId,
          tenantId: order.tenantId,
          warehouseId: order.warehouseId,
          ...(item.variantId && { variantId: item.variantId }),
          variant: {
            product: {
              tenantId: order.tenantId,
              ...(item.productId && { id: item.productId }),
            },
          },
          transactions: {
            some: {
              type: 'RESERVATION',
              quantity: entry.quantity,
              referenceId: `special-sourcing:${entry.operationId}:${item.id}`,
            },
          },
        },
        select: { id: true, variantId: true },
      });
      if (!row) inventoryConflict();
      grouped.set(row.id, {
        variantId: row.variantId,
        quantity:
          (grouped.get(row.id)?.quantity ?? 0) + netSourcingQuantity(entry),
      });
    }
  }
  return [...grouped.entries()].sort(
    ([leftId, left], [rightId, right]) =>
      left.variantId.localeCompare(right.variantId) ||
      leftId.localeCompare(rightId),
  );
}

async function inventoryEvidence(
  tx: Tx,
  order: Order,
  alreadyConsumedId?: string,
  consumeId?: string,
) {
  const groups = await reservationGroups(tx, order);
  const repository = new InventoryRepository(tx);
  for (const [inventoryId, { quantity }] of groups) {
    if (alreadyConsumedId) {
      const evidence = await repository.findTransactionByReference(
        order.tenantId,
        inventoryId,
        'SALE',
        `special-fulfillment:${alreadyConsumedId}`,
      );
      if (evidence?.quantity !== quantity) inventoryConflict();
      continue;
    }
    const [row] = await tx.$queryRaw<{ count: number }[]>`
      SELECT "reservedQuantity" AS count FROM "Inventory" WHERE id = ${inventoryId}
        AND "tenantId" = ${order.tenantId} AND "warehouseId" = ${order.warehouseId}
      FOR UPDATE
    `;
    if (!row || row.count < quantity) inventoryConflict();
    if (consumeId) {
      if ((await repository.sale(order.tenantId, inventoryId, quantity)) !== 1)
        inventoryConflict();
      await repository.createTransaction(order.tenantId, {
        inventoryId,
        quantity,
        type: 'SALE',
        referenceId: `special-fulfillment:${consumeId}`,
      });
    }
  }
}

export async function fulfillOrder(
  actor: Actor,
  id: string,
  key: string,
  input: Input,
) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  return prisma.$transaction(async (tx) => {
    const scope = { tenantId: actor.tenantId };
    const lock = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SpecialOrder" WHERE id = ${id} AND "tenantId" = ${actor.tenantId} FOR UPDATE
    `;
    if (!lock.length) missing();
    const order = await load(tx, scope, id);
    const prior = order.fulfillmentEvents.find((event) => event.key === key);
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        conflict(
          'SPECIAL_FULFILLMENT_KEY_CONFLICT',
          'Use a new idempotency key for a different fulfillment action',
        );
      return result(order, true);
    }
    if (
      order.cancellationStatus === 'CANCELLED' ||
      (order.cancellationStatus === 'UNDER_REVIEW' &&
        !['DELIVER', 'PICK_UP', 'DELIVERY_ATTEMPT', 'REMIT_CASH'].includes(
          input.action,
        ))
    ) {
      conflict(
        'SPECIAL_CANCELLATION_REVIEW',
        'The cancellation status blocks this fulfillment action',
      );
    }
    const financial = financialSummary(order);
    const { outstanding } = paymentPosition(order);
    if (order.fulfillmentDiscrepancy || financial.financialConflict) {
      conflict(
        'SPECIAL_FULFILLMENT_BLOCKED',
        'Resolve the recorded fulfillment or payment discrepancy first',
      );
    }
    if (
      !order.readyAt ||
      !order.warehouseId ||
      !paymentPosition(order).initialCollected.gte(order.initialPayment) ||
      !financial.onlinePaymentPrerequisiteSatisfied
    ) {
      conflict(
        'SPECIAL_FULFILLMENT_NOT_ELIGIBLE',
        'The order requires complete sourcing and verified online payment',
      );
    }
    const dispatch = eventFor(order.fulfillmentEvents, 'DISPATCH');
    const availability = eventFor(
      order.fulfillmentEvents,
      'AVAILABLE_FOR_PICKUP',
    );
    const handover = eventFor(
      order.fulfillmentEvents,
      order.fulfillmentMethod === 'HOME_DELIVERY' ? 'DELIVER' : 'PICK_UP',
    );
    const delivery = order.fulfillmentMethod === 'HOME_DELIVERY';
    const isHandover = input.action === 'DELIVER' || input.action === 'PICK_UP';
    const handedOver =
      order.state === 'DELIVERED' || order.state === 'PICKED_UP';
    const allowed = {
      DISPATCH: delivery && order.state === 'READY_FOR_FULFILLMENT',
      AVAILABLE_FOR_PICKUP:
        !delivery && order.state === 'READY_FOR_FULFILLMENT',
      DELIVER:
        delivery &&
        order.state === 'SHIPPED' &&
        Boolean(dispatch) &&
        order.returns.length === 0,
      DELIVERY_ATTEMPT:
        delivery && order.state === 'SHIPPED' && Boolean(dispatch),
      PICK_UP:
        !delivery && order.state === 'AWAITING_PICKUP' && Boolean(availability),
      REMIT_CASH:
        handedOver && !eventFor(order.fulfillmentEvents, 'REMIT_CASH'),
      COMPLETE: handedOver && !order.completedAt,
    };
    if (!allowed[input.action])
      conflict(
        'SPECIAL_FULFILLMENT_STATE',
        'This action is unavailable in the current fulfillment state',
      );
    if (
      ['DISPATCH', 'AVAILABLE_FOR_PICKUP', 'PICK_UP'].includes(input.action)
    ) {
      await validateFulfillmentWarehouse(tx, order, order.warehouseId);
    }
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : new Date();
    const earliest =
      handover?.occurredAt ??
      dispatch?.occurredAt ??
      availability?.occurredAt ??
      order.readyAt;
    const invalidDate = occurredAt < earliest || occurredAt > new Date();
    if (
      (!isHandover && invalidDate) ||
      (input.action === 'DISPATCH' &&
        input.estimatedDeliveryAt &&
        new Date(input.estimatedDeliveryAt) < occurredAt)
    ) {
      conflict(
        'SPECIAL_FULFILLMENT_DATE',
        'The supplied time is inconsistent with the fulfillment timeline',
      );
    }
    const cashObligation = order.paymentObligations.find(
      ({ method }) => method === 'CASH',
    );
    if (input.action === 'COMPLETE' && !outstanding.isZero()) {
      conflict(
        'SPECIAL_FULFILLMENT_PAYMENT_DUE',
        'Verify all required customer payments before completion',
      );
    }
    if (input.action === 'REMIT_CASH' && !cashObligation?.cashSettlement) {
      conflict(
        'SPECIAL_FULFILLMENT_NO_CASH',
        'There is no verified cash collection to remit',
      );
    }
    const evidence = JSON.parse(
      JSON.stringify(input),
    ) as Prisma.InputJsonObject;
    const event = await tx.specialOrderFulfillmentEvent.create({
      data: {
        tenantId: actor.tenantId,
        orderId: id,
        action: input.action,
        key,
        fingerprint,
        actorId: actor.userId,
        occurredAt,
        evidence,
      },
    });
    const notification = async (type: Parameters<typeof notify>[4]) =>
      notify(
        tx,
        actor.tenantId,
        order.requestId,
        order.customerId,
        type,
        event.id,
      );
    if (input.action === 'DISPATCH') {
      await inventoryEvidence(tx, order, undefined, event.id);
      await tx.specialOrder.update({
        where: { id },
        data: { state: 'SHIPPED' },
      });
      await notification('SPECIAL_ORDER_DISPATCHED');
    } else if (input.action === 'AVAILABLE_FOR_PICKUP') {
      await inventoryEvidence(tx, order);
      await tx.specialOrder.update({
        where: { id },
        data: { state: 'AWAITING_PICKUP' },
      });
      await notification('SPECIAL_ORDER_AWAITING_PICKUP');
    } else if (input.action === 'DELIVERY_ATTEMPT') {
      await inventoryEvidence(tx, order, dispatch!.id);
      await notification('SPECIAL_ORDER_DELIVERY_FAILED');
    } else if (input.action === 'DELIVER' || input.action === 'PICK_UP') {
      let discrepancy =
        invalidDate || !input.handedOver
          ? 'HANDOVER_EVIDENCE_INCONSISTENT'
          : null;
      if (input.action === 'DELIVER')
        await inventoryEvidence(tx, order, dispatch!.id);
      if (!discrepancy) {
        if (input.action === 'PICK_UP')
          await inventoryEvidence(tx, order, undefined, event.id);
        const cashRequired = outstanding.gt(0);
        const cashMatches = Boolean(
          cashObligation &&
          input.cash &&
          !cashObligation.cashSettlement &&
          cashObligation.currency === order.currency &&
          input.cash.currency === order.currency &&
          cashObligation.amount.equals(outstanding) &&
          parseDecimal(input.cash.observedAmount).equals(outstanding),
        );
        if ((cashRequired && !cashMatches) || (!cashRequired && input.cash))
          discrepancy = 'CASH_EVIDENCE_INCONSISTENT';
        if (!discrepancy && cashRequired && cashObligation) {
          await tx.specialOrderPaymentSettlement.create({
            data: {
              tenantId: order.tenantId,
              cashObligationId: cashObligation.id,
              cashEventId: event.id,
              provider: 'NONE',
              transactionId: `special-cash:${event.id}`,
              providerTransactionId: `special-cash:${event.id}`,
              amount: cashObligation.amount,
              currency: order.currency,
              attributable: true,
              verifiedAt: occurredAt,
            },
          });
        }
        await tx.specialOrder.update({
          where: { id },
          data: {
            state: input.action === 'DELIVER' ? 'DELIVERED' : 'PICKED_UP',
            fulfillmentDiscrepancy: discrepancy,
            ...(!discrepancy && cashRequired && { paymentStatus: 'PAID' }),
          },
        });
        if (!discrepancy) await notification('SPECIAL_ORDER_HANDED_OVER');
      } else {
        await tx.specialOrder.update({
          where: { id },
          data: { fulfillmentDiscrepancy: discrepancy },
        });
      }
    } else if (input.action === 'COMPLETE') {
      if (!handover)
        conflict(
          'SPECIAL_HANDOVER_MISSING',
          'Record actual customer handover first',
        );
      await inventoryEvidence(tx, order, delivery ? dispatch!.id : handover.id);
      await tx.specialOrder.update({
        where: { id },
        data: { completedAt: occurredAt },
      });
      await notification('SPECIAL_ORDER_COMPLETED');
    }
    return result(await load(tx, scope, id), true);
  });
}
