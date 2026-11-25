import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { currencyPrecision } from '../../common/pricing/currency.js';
import { parseDecimal } from '../../common/pricing/money.js';
import { prisma } from '../../config/database.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { InventoryRepository } from '../inventory/inventory.repository.js';
import {
  financialRelations,
  financialSummary,
  paymentPosition,
} from './special-order-financial-summary.js';
import { fulfillmentRelations } from './special-order-fulfillment.service.js';
import {
  allocateRefunds,
  lockResolutionOrder,
  publicRefund,
  resolutionConflict,
  resolutionEvent,
  type ResolutionTx,
} from './special-order-refunds.service.js';
import {
  customerResolutionSchema,
  merchantResolutionSchema,
  resolutionItemsSchema,
} from './special-order.schemas.js';
import { netSourcingQuantity } from './special-order-sourcing.service.js';
import { notify, type Actor, type Scope } from './special-order.service.js';

type Input =
  | z.infer<typeof customerResolutionSchema>
  | z.infer<typeof merchantResolutionSchema>;
type Line = z.infer<typeof resolutionItemsSchema>[number];
type Receipt = Extract<
  Input,
  { action: 'RECEIVE_RETURN' | 'WAREHOUSE_RETURN' }
>;
export const resolutionRelations = {
  returns: { orderBy: { createdAt: 'asc' } },
  resolutionEvents: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SpecialOrderInclude;

const include = {
  ...financialRelations,
  ...fulfillmentRelations,
  ...resolutionRelations,
  items: {
    include: {
      sourcingEntries: {
        include: {
          corrections: true,
          inventory: true,
          operation: { select: { action: true } },
        },
      },
    },
  },
} satisfies Prisma.SpecialOrderInclude;
type Order = Prisma.SpecialOrderGetPayload<{ include: typeof include }>;
type Entry = Order['items'][number]['sourcingEntries'][number];

function fail(message: string): never {
  return resolutionConflict('SPECIAL_RESOLUTION_NOT_ALLOWED', message);
}
const preDispatch = (order: Order) =>
  !order.fulfillmentEvents.some(
    ({ action }) =>
      action === 'DISPATCH' ||
      (action === 'PICK_UP' && order.state === 'PICKED_UP'),
  );
const handedOver = (order: Order) =>
  order.state === 'DELIVERED' || order.state === 'PICKED_UP';

async function load(tx: ResolutionTx, scope: Scope, id: string) {
  const order = await tx.specialOrder.findFirst({
    where: { ...scope, id },
    include,
  });
  if (!order)
    throw new AppError(
      'Special order not found',
      404,
      'SPECIAL_ORDER_NOT_FOUND',
    );
  return order;
}

export function presentResolutions(
  order: Pick<
    Order,
    'cancellationStatus' | 'returns' | 'resolutionEvents' | 'refunds'
  >,
  merchant: boolean,
) {
  return {
    cancellationStatus: order.cancellationStatus,
    returns: order.returns.map(
      ({ id, items, receipt, status, createdAt, warehouseReturn }) => ({
        id,
        items,
        status,
        createdAt,
        warehouseReturn,
        ...(merchant && { receipt }),
      }),
    ),
    refunds: order.refunds.map((refund) => publicRefund(refund, merchant)),
    ...(merchant && { events: order.resolutionEvents }),
  };
}

export async function getResolutions(scope: Scope, id: string) {
  const order = await load(prisma, scope, id);
  return {
    ...presentResolutions(order, scope.customerId === undefined),
    paymentSummary: financialSummary(order),
    ...(scope.customerId === undefined && {
      sourcingEntries: order.items
        .flatMap(({ sourcingEntries }) => sourcingEntries)
        .map((entry) => ({
          id: entry.id,
          itemId: entry.itemId,
          operationId: entry.operationId,
          action: entry.operation.action,
          allocatedQuantity: netSourcingQuantity(entry),
          catalog: Boolean(entry.inventoryId),
        })),
    }),
  };
}

function hasUnresolvedPayment(order: Order) {
  return order.paymentObligations.some(({ attempts }) =>
    attempts.some(
      ({ status, initiationState }) =>
        initiationState === 'UNKNOWN' ||
        initiationState === 'IN_PROGRESS' ||
        !['PAID', 'FAILED', 'CANCELLED'].includes(status),
    ),
  );
}

function checkLines(order: Order, lines: Line[], warehouseReturn: boolean) {
  if (new Set(lines.map(({ itemId }) => itemId)).size !== lines.length)
    fail('Select each item once');
  for (const { itemId, quantity } of lines) {
    const original = order.items.find(({ id }) => id === itemId);
    if (!original) fail('The item does not belong to this order');
    const allocated = order.returns
      .filter(
        (entry) =>
          entry.warehouseReturn === warehouseReturn &&
          entry.status !== 'REJECTED',
      )
      .flatMap((entry) => resolutionItemsSchema.parse(entry.items))
      .reduce(
        (sum, line) => sum + (line.itemId === itemId ? line.quantity : 0),
        0,
      );
    if (quantity + allocated > original.quantity)
      fail('Return quantity exceeds the unallocated order quantity');
  }
}

async function requireOwnedInventory(
  tx: ResolutionTx,
  order: Order,
  entry: Entry,
) {
  const row = entry.inventory;
  if (
    !row ||
    row.tenantId !== order.tenantId ||
    row.warehouseId !== order.warehouseId
  )
    fail('Reservation inventory ownership could not be verified');
  const repo = new InventoryRepository(tx);
  const original = await repo.findTransactionByReference(
    order.tenantId,
    row.id,
    'RESERVATION',
    `special-sourcing:${entry.operationId}:${entry.itemId}`,
  );
  if (original?.quantity !== entry.quantity)
    fail('Reservation evidence could not be verified');
  return { row, repo };
}

async function release(
  tx: ResolutionTx,
  order: Order,
  entry: Entry,
  qty: number,
  reference: string,
  physical: boolean,
) {
  if (!entry.inventoryId) return;
  const { row, repo } = await requireOwnedInventory(tx, order, entry);
  if ((await repo.release(order.tenantId, row.id, qty)) !== 1)
    fail('The reservation cannot safely be released');
  await repo.createTransaction(order.tenantId, {
    inventoryId: row.id,
    type: 'RELEASE',
    quantity: qty,
    referenceId: reference,
  });
  if (physical) {
    if (
      entry.operation.action !== 'RECEIVE' ||
      (await repo.stockOut(order.tenantId, row.id, qty)) !== 1
    )
      fail('The physical receipt cannot safely be reversed');
    await repo.createTransaction(order.tenantId, {
      inventoryId: row.id,
      type: 'STOCK_OUT',
      quantity: qty,
      referenceId: reference,
    });
  }
}

async function cancel(tx: ResolutionTx, order: Order, eventId: string) {
  if (hasUnresolvedPayment(order))
    fail('Reconcile pending or unknown payments before cancellation');
  const entries = order.items
    .flatMap(({ sourcingEntries }) => sourcingEntries)
    .sort(
      (a, b) =>
        (a.inventory?.variantId ?? '').localeCompare(
          b.inventory?.variantId ?? '',
        ) || a.id.localeCompare(b.id),
    );
  for (const entry of entries) {
    const qty = netSourcingQuantity(entry);
    if (qty > 0)
      await release(
        tx,
        order,
        entry,
        qty,
        `special-resolution:${eventId}:${entry.id}`,
        false,
      );
  }
  await tx.specialOrder.update({
    where: { id: order.id },
    data: { cancellationStatus: 'CANCELLED' },
  });
  await allocateRefunds(tx, order, 'CANCELLATION');
}

function countsReceived(order: Order, warehouseReturn: boolean) {
  return order.returns
    .filter(
      (entry) =>
        entry.warehouseReturn === warehouseReturn &&
        entry.status === 'RECEIVED',
    )
    .flatMap((entry) => resolutionItemsSchema.parse(entry.items))
    .reduce(
      (byItem, item) =>
        byItem.set(item.itemId, (byItem.get(item.itemId) ?? 0) + item.quantity),
      new Map<string, number>(),
    );
}

function refundValue(
  order: Order,
  before: Map<string, number>,
  after: Map<string, number>,
) {
  const scale = 10n ** BigInt(currencyPrecision(order.currency));
  const units = (value: Prisma.Decimal) =>
    BigInt(parseDecimal(value.toFixed()).mul(scale.toString()).toFixed(0));
  const prorate = (original: bigint, qty: number, required: number) =>
    (original * BigInt(qty) * 2n + BigInt(required)) / (BigInt(required) * 2n);
  const items = order.items.reduce((sum, item) => {
    const old = before.get(item.id) ?? 0;
    const current = after.get(item.id) ?? 0;
    return (
      sum +
      prorate(units(item.totalIncludingTax), current, item.quantity) -
      prorate(units(item.totalIncludingTax), old, item.quantity)
    );
  }, 0n);
  if (order.items.every((item) => after.get(item.id) === item.quantity)) {
    return parseDecimal(order.grandTotal.toFixed()).minus(
      order.refunds.reduce(
        (sum, refund) => sum.plus(refund.amount.toFixed()),
        parseDecimal('0'),
      ),
    );
  }
  // Construct an exact minor-unit amount without passing through JS numbers.
  return parseDecimal(items.toString()).div(scale.toString());
}

async function receive(
  tx: ResolutionTx,
  order: Order,
  input: Receipt,
  eventId: string,
) {
  if (input.warehouseId !== order.warehouseId)
    fail('Receive into the assigned warehouse');
  const warehouse = await tx.warehouse.findFirst({
    where: { id: input.warehouseId, tenantId: order.tenantId, isActive: true },
  });
  if (!warehouse)
    fail('The receiving warehouse is inactive or outside the tenant');
  const dispatched = [...order.fulfillmentEvents]
    .reverse()
    .find(
      ({ action }) =>
        action ===
        (order.fulfillmentMethod === 'HOME_DELIVERY' ? 'DISPATCH' : 'PICK_UP'),
    );
  if (!dispatched) fail('Original stock handover evidence is missing');
  const receipts = [];
  for (const line of input.items) {
    const item = order.items.find(({ id }) => id === line.itemId);
    if (!item) fail('The item does not belong to the order');
    if (!item.productId && !item.variantId) continue;
    const entries = item.sourcingEntries.filter(
      (entry) => netSourcingQuantity(entry) > 0,
    );
    const entry = entries[0];
    if (
      !entry ||
      entries.some(({ inventoryId }) => inventoryId !== entry.inventoryId)
    )
      fail('The original catalog inventory could not be verified');
    const { row, repo } = await requireOwnedInventory(tx, order, entry);
    const sale = await repo.findTransactionByReference(
      order.tenantId,
      row.id,
      'SALE',
      `special-fulfillment:${dispatched.id}`,
    );
    const expected = order.items
      .flatMap((orderItem) => orderItem.sourcingEntries)
      .filter(({ inventoryId }) => inventoryId === row.id)
      .reduce((sum, sourcing) => sum + netSourcingQuantity(sourcing), 0);
    if (sale?.quantity !== expected || expected < line.quantity)
      fail('The original stock consumption could not be verified');
    if (line.condition === 'SELLABLE') receipts.push({ row, repo, line });
  }
  for (const { row, repo, line } of receipts.sort((a, b) =>
    a.row.variantId.localeCompare(b.row.variantId),
  )) {
    if ((await repo.stockIn(order.tenantId, row.id, line.quantity)) !== 1)
      fail('Stock could not be restored');
    await repo.createTransaction(order.tenantId, {
      inventoryId: row.id,
      type: 'STOCK_IN',
      quantity: line.quantity,
      referenceId: `special-resolution:${eventId}:${line.itemId}`,
    });
  }
}

async function reconcileCash(
  tx: ResolutionTx,
  order: Order,
  actor: Actor,
  input: Extract<Input, { action: 'RECONCILE_CASH' }>,
  key: string,
  resolutionId: string,
) {
  if (
    !handedOver(order) ||
    order.fulfillmentDiscrepancy !== 'CASH_EVIDENCE_INCONSISTENT'
  )
    fail('There is no cash discrepancy to reconcile');
  const obligation = order.paymentObligations.find(
    ({ method }) => method === 'CASH',
  );
  const { outstanding } = paymentPosition(order);
  if (
    !obligation ||
    obligation.cashSettlement ||
    !outstanding.gt(0) ||
    !obligation.amount.equals(outstanding) ||
    input.cash.currency !== obligation.currency ||
    !parseDecimal(input.cash.observedAmount).equals(outstanding)
  ) {
    fail(
      'Record the actual verified cash amount and currency for the outstanding obligation',
    );
  }
  const original = [...order.fulfillmentEvents]
    .reverse()
    .find(({ action }) => ['DELIVER', 'PICK_UP'].includes(action));
  if (!original) fail('The original handover evidence is missing');
  const event = await tx.specialOrderFulfillmentEvent.create({
    data: {
      tenantId: order.tenantId,
      orderId: order.id,
      action: 'RECONCILE_CASH',
      key: `resolution:${resolutionId}`,
      fingerprint: key,
      actorId: actor.userId,
      occurredAt: new Date(),
      evidence: {
        ...input,
        handedOver: true,
        originalEventId: original.id,
      },
    },
  });
  await tx.specialOrderPaymentSettlement.create({
    data: {
      tenantId: order.tenantId,
      cashObligationId: obligation.id,
      cashEventId: event.id,
      provider: 'NONE',
      transactionId: `special-cash:${event.id}`,
      providerTransactionId: `special-cash:${event.id}`,
      amount: obligation.amount,
      currency: obligation.currency,
      attributable: true,
      verifiedAt: event.occurredAt,
    },
  });
  await tx.specialOrder.update({
    where: { id: order.id },
    data: { fulfillmentDiscrepancy: null, paymentStatus: 'PAID' },
  });
}

export async function resolveOrder(
  actor: Actor,
  id: string,
  key: string,
  input: Input,
  merchant: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const scope = {
      tenantId: actor.tenantId,
      ...(!merchant && { customerId: actor.userId }),
    };
    await lockResolutionOrder(tx, scope, id);
    const order = await load(tx, scope, id);
    const { action, reason, ...evidence } = input;
    const { record, replayed } = await resolutionEvent(
      tx,
      actor,
      id,
      key,
      action,
      reason,
      evidence,
    );
    if (!replayed) {
      switch (input.action) {
        case 'REQUEST_CANCELLATION':
        case 'CANCEL':
          if (order.cancellationStatus === 'CANCELLED' || handedOver(order))
            fail('Use the customer return workflow after handover');
          if (!preDispatch(order)) {
            if (
              input.action === 'REQUEST_CANCELLATION' &&
              order.state === 'SHIPPED'
            ) {
              if (order.cancellationStatus === 'UNDER_REVIEW')
                fail('A cancellation request is already under review');
              await tx.specialOrder.update({
                where: { id },
                data: { cancellationStatus: 'UNDER_REVIEW' },
              });
              break;
            }
            const received = countsReceived(order, true);
            if (
              input.action !== 'CANCEL' ||
              order.state !== 'SHIPPED' ||
              !order.items.every(
                (item) => received.get(item.id) === item.quantity,
              )
            )
              fail(
                'Record the complete warehouse return before closing the shipment',
              );
            if (hasUnresolvedPayment(order))
              fail('Reconcile pending or unknown payments before cancellation');
            await tx.specialOrder.update({
              where: { id },
              data: { cancellationStatus: 'CANCELLED' },
            });
            await allocateRefunds(tx, order, 'CANCELLATION');
            await notify(
              tx,
              order.tenantId,
              order.requestId,
              order.customerId,
              'SPECIAL_ORDER_CANCELLED',
              record.id,
            );
            break;
          }
          if (
            input.action === 'REQUEST_CANCELLATION' &&
            (order.state !== 'PENDING_SOURCING' || hasUnresolvedPayment(order))
          ) {
            if (order.cancellationStatus === 'UNDER_REVIEW')
              fail('A cancellation request is already under review');
            await tx.specialOrder.update({
              where: { id },
              data: { cancellationStatus: 'UNDER_REVIEW' },
            });
          } else {
            if (order.fulfillmentDiscrepancy)
              fail(
                'Resolve the handover discrepancy before releasing any stock',
              );
            await cancel(tx, order, record.id);
            await notify(
              tx,
              order.tenantId,
              order.requestId,
              order.customerId,
              'SPECIAL_ORDER_CANCELLED',
              record.id,
            );
          }
          break;
        case 'REJECT_CANCELLATION':
          if (order.cancellationStatus !== 'UNDER_REVIEW')
            fail('No cancellation request is under review');
          await tx.specialOrder.update({
            where: { id },
            data: { cancellationStatus: 'NONE' },
          });
          await notify(
            tx,
            order.tenantId,
            order.requestId,
            order.customerId,
            'SPECIAL_ORDER_CANCELLATION_REJECTED',
            record.id,
          );
          break;
        case 'REQUEST_RETURN':
          if (!handedOver(order))
            fail('Only handed-over items can be requested for return');
          checkLines(order, input.items, false);
          await tx.specialOrderReturn.create({
            data: { tenantId: order.tenantId, orderId: id, items: input.items },
          });
          break;
        case 'DECIDE_RETURN': {
          const requested = order.returns.find(
            ({ id: returnId }) => returnId === input.returnId,
          );
          if (!requested || requested.status !== 'REQUESTED')
            fail('A requested return is required');
          await tx.specialOrderReturn.update({
            where: { id: requested.id },
            data: { status: input.approved ? 'APPROVED' : 'REJECTED' },
          });
          await notify(
            tx,
            order.tenantId,
            order.requestId,
            order.customerId,
            'SPECIAL_ORDER_RETURN_DECIDED',
            record.id,
          );
          break;
        }
        case 'WAREHOUSE_RETURN':
        case 'RECEIVE_RETURN': {
          const warehouseReturn = input.action === 'WAREHOUSE_RETURN';
          if (warehouseReturn) {
            if (
              order.state !== 'SHIPPED' ||
              !order.fulfillmentEvents.some(
                ({ action }) => action === 'DELIVERY_ATTEMPT',
              ) ||
              order.cancellationStatus === 'CANCELLED'
            )
              fail('Record the failed delivery before a warehouse return');
            if (order.fulfillmentDiscrepancy)
              fail(
                'Resolve the handover discrepancy before receiving a failed delivery',
              );
            checkLines(order, input.items, true);
          } else {
            const approved = order.returns.find(
              ({ id: returnId }) => returnId === input.returnId,
            );
            if (
              !handedOver(order) ||
              !approved ||
              approved.status !== 'APPROVED'
            )
              fail('An approved customer return is required');
            const normalized = (lines: Line[]) =>
              JSON.stringify(
                lines.map(({ itemId, quantity }) => [itemId, quantity]).sort(),
              );
            if (
              normalized(resolutionItemsSchema.parse(approved.items)) !==
              normalized(input.items)
            )
              fail('The receipt must match the approved quantities');
          }
          const before = countsReceived(order, warehouseReturn);
          await receive(tx, order, input, record.id);
          const receipt = {
            ...evidence,
            receivedAt: record.createdAt.toISOString(),
            actorId: actor.userId,
          };
          if (input.action === 'RECEIVE_RETURN')
            await tx.specialOrderReturn.update({
              where: { id: input.returnId },
              data: { status: 'RECEIVED', receipt },
            });
          else
            await tx.specialOrderReturn.create({
              data: {
                tenantId: order.tenantId,
                orderId: id,
                items: input.items.map(({ itemId, quantity }) => ({
                  itemId,
                  quantity,
                })),
                receipt,
                warehouseReturn: true,
                status: 'RECEIVED',
              },
            });
          const after = countsReceived(
            await load(tx, scope, id),
            warehouseReturn,
          );
          if (warehouseReturn) {
            if (
              order.items.every((item) => after.get(item.id) === item.quantity)
            ) {
              const unresolved = hasUnresolvedPayment(order);
              await tx.specialOrder.update({
                where: { id },
                data: {
                  cancellationStatus: unresolved ? 'UNDER_REVIEW' : 'CANCELLED',
                },
              });
              if (!unresolved) await allocateRefunds(tx, order, 'CANCELLATION');
            }
          } else {
            await allocateRefunds(
              tx,
              order,
              input.returnId,
              refundValue(order, before, after),
            );
          }
          await notify(
            tx,
            order.tenantId,
            order.requestId,
            order.customerId,
            'SPECIAL_ORDER_RETURN_RECEIVED',
            record.id,
          );
          break;
        }
        case 'CORRECT_SOURCING': {
          if (
            !['SOURCING', 'READY_FOR_FULFILLMENT', 'AWAITING_PICKUP'].includes(
              order.state,
            ) ||
            !preDispatch(order) ||
            order.cancellationStatus !== 'NONE' ||
            order.fulfillmentDiscrepancy
          )
            fail('This order cannot be corrected in its current state');
          const entry = order.items
            .flatMap(({ sourcingEntries }) => sourcingEntries)
            .find(({ id: entryId }) => entryId === input.entryId);
          if (
            !entry ||
            input.quantity > netSourcingQuantity(entry) ||
            Boolean(entry.inventoryId) !==
              (input.correction !== 'REVERSE_SECURED')
          )
            fail('The correction does not match the original sourcing record');
          await release(
            tx,
            order,
            entry,
            input.quantity,
            `special-resolution:${record.id}`,
            input.correction === 'REVERSE_RECEIPT',
          );
          await tx.specialOrderSourcingCorrection.create({
            data: {
              eventId: record.id,
              entryId: entry.id,
              quantity: input.quantity,
            },
          });
          if (order.state !== 'SOURCING')
            await tx.specialOrder.update({
              where: { id },
              data: { state: 'SOURCING', readyAt: null },
            });
          break;
        }
        case 'CLEAR_HANDOVER_DISCREPANCY':
          if (
            handedOver(order) ||
            order.fulfillmentDiscrepancy !== 'HANDOVER_EVIDENCE_INCONSISTENT'
          )
            fail('Only a recorded unsuccessful handover may be cleared');
          await tx.specialOrder.update({
            where: { id },
            data: { fulfillmentDiscrepancy: null },
          });
          break;
        case 'RECONCILE_CASH':
          await reconcileCash(tx, order, actor, input, key, record.id);
          break;
      }
    }
    const latest = await load(tx, scope, id);
    return {
      ...presentResolutions(latest, merchant),
      paymentSummary: financialSummary(latest),
    };
  });
}
