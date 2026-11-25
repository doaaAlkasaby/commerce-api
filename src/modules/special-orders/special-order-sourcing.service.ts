import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import { prisma } from '../../config/database.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { InventoryRepository } from '../inventory/inventory.repository.js';
import {
  financialRelations,
  financialSummary,
} from './special-order-financial-summary.js';
import {
  specialOrderMarket,
  specialProviderAccount,
} from './special-order-provider.js';
import { notify, type Actor, type Scope } from './special-order.service.js';

export const sourcingRelations = {
  warehouse: { select: { id: true, name: true, code: true } },
  items: {
    orderBy: { position: 'asc' },
    include: {
      sourcingEntries: {
        select: {
          quantity: true,
          inventoryId: true,
          corrections: { select: { quantity: true } },
        },
      },
    },
  },
} satisfies Prisma.SpecialOrderInclude;
const include = { ...financialRelations, ...sourcingRelations };
type SourcingOrder = Prisma.SpecialOrderGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
type Input =
  | { action: 'START'; warehouseId: string }
  | { action: 'RESERVE' | 'READY' }
  | { action: 'RECEIVE' | 'SECURE'; itemId: string; quantity: number };

function reject(code: string, message: string): never {
  throw new AppError(message, 409, code);
}

function missing(): never {
  throw new AppError(
    'Special order or item not found',
    404,
    'SPECIAL_ORDER_NOT_FOUND',
  );
}

function catalog(item: { productId: string | null; variantId: string | null }) {
  return Boolean(item.productId || item.variantId);
}

export function netSourcingQuantity(entry: {
  quantity: number;
  corrections: { quantity: number }[];
}) {
  return entry.corrections.reduce(
    (remaining, correction) => remaining - correction.quantity,
    entry.quantity,
  );
}

function quantities(item: SourcingOrder['items'][number]) {
  const reservedCatalogQuantity = item.sourcingEntries.reduce(
    (sum, entry) => sum + (entry.inventoryId ? netSourcingQuantity(entry) : 0),
    0,
  );
  const securedNonCatalogQuantity = item.sourcingEntries.reduce(
    (sum, entry) => sum + (entry.inventoryId ? 0 : netSourcingQuantity(entry)),
    0,
  );
  return {
    requiredQuantity: item.quantity,
    reservedCatalogQuantity,
    securedNonCatalogQuantity,
    remainingQuantity:
      item.quantity - reservedCatalogQuantity - securedNonCatalogQuantity,
  };
}

export function sourcingProgress(order: SourcingOrder, merchant: boolean) {
  const financial = financialSummary(order);
  const items = order.items.map((item) => ({
    itemId: item.id,
    ...(order.cancellationStatus === 'CANCELLED'
      ? {
          requiredQuantity: item.quantity,
          reservedCatalogQuantity: 0,
          securedNonCatalogQuantity: 0,
          remainingQuantity: 0,
        }
      : quantities(item)),
  }));
  const outstanding = items.some(
    ({ remainingQuantity }) => remainingQuantity !== 0,
  );
  return {
    state: order.state,
    sourcingStartedAt: order.sourcingStartedAt,
    readyAt: order.readyAt,
    items: merchant
      ? items
      : items.map(({ itemId, requiredQuantity, remainingQuantity }) => ({
          itemId,
          requiredQuantity,
          securedQuantity: requiredQuantity - remainingQuantity,
        })),
    ...(merchant && {
      warehouse: order.warehouse,
      canMarkReady:
        order.state === 'SOURCING' &&
        !outstanding &&
        financial.initialSourcingPrerequisiteSatisfied,
      blockers: [
        ...(!order.warehouseId ? ['WAREHOUSE_REQUIRED'] : []),
        ...(outstanding ? ['QUANTITIES_OUTSTANDING'] : []),
        ...(!financial.initialSourcingPrerequisiteSatisfied
          ? [financial.financialConflict ?? 'INITIAL_PAYMENT_REQUIRED']
          : []),
      ],
    }),
  };
}

async function load(tx: Tx, scope: Scope, id: string) {
  return (
    (await tx.specialOrder.findFirst({ where: { ...scope, id }, include })) ??
    missing()
  );
}
export async function getSourcing(scope: Scope, id: string) {
  return sourcingProgress(await load(prisma, scope, id), true);
}

function field(json: Prisma.JsonValue, key: string) {
  return json &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    typeof json[key] === 'string'
    ? json[key].trim().toUpperCase()
    : null;
}

export async function validateFulfillmentWarehouse(
  tx: Tx,
  order: Pick<
    SourcingOrder,
    'tenantId' | 'fulfillmentMethod' | 'pickupLocation' | 'deliveryAddress'
  >,
  id: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Warehouse" WHERE id=${id} AND "tenantId"=${order.tenantId} AND "isActive" FOR SHARE
  `;
  if (!rows.length)
    reject(
      'SPECIAL_WAREHOUSE_UNAVAILABLE',
      'Select an active fulfillment warehouse for this tenant',
    );
  const found = await tx.warehouse.findUniqueOrThrow({
    where: { id },
    include: { coverage: true, country: { select: { isActive: true } } },
  });
  const pickup = order.fulfillmentMethod === 'STORE_PICKUP';
  const destination = pickup ? order.pickupLocation : order.deliveryAddress;
  const country = field(destination, 'countryCode');
  const region = field(destination, 'regionCode');
  const eligible = pickup
    ? found.countryCode === country &&
      (!region || found.region?.trim().toUpperCase() === region)
    : found.coverage.some(
        (covered) =>
          covered.tenantId === order.tenantId &&
          covered.countryCode === country,
      );
  if (!found.country.isActive || !eligible)
    reject(
      'SPECIAL_WAREHOUSE_INCOMPATIBLE',
      'The warehouse does not serve this fulfillment destination',
    );
  return found;
}

async function variant(
  tx: Tx,
  tenantId: string,
  item: SourcingOrder['items'][number],
) {
  const variants = await tx.productVariant.findMany({
    where: {
      product: { tenantId, ...(item.productId && { id: item.productId }) },
      ...(item.variantId ? { id: item.variantId } : { isDefault: true }),
    },
    select: { id: true },
    take: 2,
  });
  return variants.length === 1 ? variants[0]!.id : null;
}

async function recordStock(
  tx: Tx,
  order: SourcingOrder,
  warehouseId: string,
  operationId: string,
  item: SourcingOrder['items'][number],
  variantId: string,
  maximum: number,
  receive: boolean,
) {
  if (receive) {
    await tx.$executeRaw`
      INSERT INTO "Inventory" (id, "tenantId", "warehouseId", "variantId", "quantity", "reservedQuantity", "updatedAt")
      VALUES (${randomUUID()}, ${order.tenantId}, ${warehouseId}, ${variantId}, 0, 0, CURRENT_TIMESTAMP)
      ON CONFLICT ("warehouseId", "variantId") DO NOTHING
    `;
  }
  const [inventory] = await tx.$queryRaw<{ id: string; available: number }[]>`
    SELECT id, ("quantity" - "reservedQuantity") AS available FROM "Inventory"
      WHERE "tenantId"=${order.tenantId} AND "warehouseId"=${warehouseId} AND "variantId"=${variantId}
      FOR UPDATE
  `;
  if (!inventory) {
    if (receive)
      reject(
        'SPECIAL_STOCK_RECEIPT_CONFLICT',
        'The inventory row could not be allocated to this warehouse',
      );
    return;
  }
  if (
    item.sourcingEntries.some(({ inventoryId }) => inventoryId !== inventory.id)
  ) {
    reject(
      'SPECIAL_INVENTORY_CONFLICT',
      'The catalog inventory reference changed after reservation',
    );
  }
  const quantity = receive ? maximum : Math.min(inventory.available, maximum);
  if (quantity <= 0) return;
  const repo = new InventoryRepository(tx);
  const referenceId = `special-sourcing:${operationId}:${item.id}`;
  if (receive) {
    if ((await repo.stockIn(order.tenantId, inventory.id, quantity)) !== 1)
      reject(
        'SPECIAL_STOCK_RECEIPT_CONFLICT',
        'The warehouse cannot receive this quantity',
      );
    await repo.createTransaction(order.tenantId, {
      inventoryId: inventory.id,
      type: 'STOCK_IN',
      quantity,
      referenceId,
    });
  }
  if ((await repo.reserve(order.tenantId, inventory.id, quantity)) !== 1)
    reject('SPECIAL_STOCK_RESERVATION_CONFLICT', 'The warehouse stock changed');
  await repo.createTransaction(order.tenantId, {
    inventoryId: inventory.id,
    type: 'RESERVATION',
    quantity,
    referenceId,
  });
  await tx.specialOrderSourcingEntry.create({
    data: {
      orderId: order.id,
      operationId,
      itemId: item.id,
      inventoryId: inventory.id,
      quantity,
    },
  });
}

export async function sourceOrder(
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
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "SpecialOrder" WHERE id=${id} AND "tenantId"=${actor.tenantId} FOR UPDATE
    `;
    if (!locked.length) missing();
    const previous = await tx.specialOrderSourcingOperation.findUnique({
      where: { orderId_key: { orderId: id, key } },
    });
    const order = await load(tx, scope, id);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        reject(
          'SPECIAL_SOURCING_KEY_CONFLICT',
          'Use a new idempotency key for this sourcing operation',
        );
      return sourcingProgress(order, true);
    }
    if (!financialSummary(order).initialSourcingPrerequisiteSatisfied)
      reject(
        'SPECIAL_SOURCING_FINANCIAL_BLOCK',
        'The initial payment or a financial conflict blocks sourcing',
      );
    if (
      !['PENDING_SOURCING', 'SOURCING'].includes(order.state) ||
      (input.action !== 'START' && order.state !== 'SOURCING')
    ) {
      reject(
        'SPECIAL_SOURCING_STATE_CONFLICT',
        'This order does not allow the sourcing action',
      );
    }
    const warehouseId =
      input.action === 'START' ? input.warehouseId : order.warehouseId;
    if (!warehouseId)
      reject(
        'SPECIAL_WAREHOUSE_REQUIRED',
        'Assign a fulfillment warehouse first',
      );
    if (
      order.warehouseId !== warehouseId &&
      order.items.some(({ sourcingEntries }) => sourcingEntries.length)
    ) {
      reject(
        'SPECIAL_WAREHOUSE_FIXED',
        'The warehouse is fixed once stock or sourcing has been recorded',
      );
    }
    await validateFulfillmentWarehouse(tx, order, warehouseId);
    const operation = await tx.specialOrderSourcingOperation.create({
      data: {
        tenantId: actor.tenantId,
        orderId: id,
        actorId: actor.userId,
        action: input.action,
        key,
        fingerprint,
      },
    });
    if (input.action === 'START') {
      await tx.specialOrder.update({
        where: { id },
        data: {
          state: 'SOURCING',
          warehouseId,
          sourcingStartedAt: order.sourcingStartedAt ?? operation.createdAt,
        },
      });
      if (!order.sourcingStartedAt)
        await notify(
          tx,
          order.tenantId,
          order.requestId,
          order.customerId,
          'SPECIAL_ORDER_SOURCING_STARTED',
          id,
        );
    }
    if (input.action === 'START' || input.action === 'RESERVE') {
      const candidates = [];
      for (const item of order.items) {
        const remaining = quantities(item).remainingQuantity;
        if (!catalog(item) || remaining <= 0) continue;
        const variantId = await variant(tx, order.tenantId, item);
        if (variantId) candidates.push({ item, variantId, remaining });
      }
      candidates.sort(
        (a, b) =>
          a.variantId.localeCompare(b.variantId) ||
          a.item.position - b.item.position,
      );
      for (const { item, variantId, remaining } of candidates) {
        await recordStock(
          tx,
          order,
          warehouseId,
          operation.id,
          item,
          variantId,
          remaining,
          false,
        );
      }
    }
    if (input.action === 'RECEIVE' || input.action === 'SECURE') {
      const item =
        order.items.find(({ id: itemId }) => itemId === input.itemId) ??
        missing();
      if (
        input.quantity > quantities(item).remainingQuantity ||
        catalog(item) !== (input.action === 'RECEIVE')
      ) {
        reject(
          'SPECIAL_SOURCING_INVALID_QUANTITY',
          'Use the matching sourcing action and stay within the outstanding quantity',
        );
      }
      if (input.action === 'RECEIVE') {
        const variantId = await variant(tx, order.tenantId, item);
        if (!variantId)
          reject(
            'SPECIAL_CATALOG_REFERENCE_INVALID',
            'The accepted catalog reference has no eligible variant',
          );
        await recordStock(
          tx,
          order,
          warehouseId,
          operation.id,
          item,
          variantId,
          input.quantity,
          true,
        );
      } else {
        await tx.specialOrderSourcingEntry.create({
          data: {
            orderId: id,
            operationId: operation.id,
            itemId: item.id,
            quantity: input.quantity,
          },
        });
      }
    }
    if (input.action === 'READY') {
      if (
        !order.items.length ||
        order.items.some((item) => quantities(item).remainingQuantity !== 0)
      ) {
        reject(
          'SPECIAL_SOURCING_INCOMPLETE',
          'Every selected item must be secured first',
        );
      }
      await tx.specialOrder.update({
        where: { id },
        data: { state: 'READY_FOR_FULFILLMENT', readyAt: operation.createdAt },
      });
      await notify(
        tx,
        order.tenantId,
        order.requestId,
        order.customerId,
        'SPECIAL_ORDER_READY',
        operation.id,
      );
      if (
        order.paymentObligations.some(
          ({ kind, method }) => kind === 'BALANCE' && method === 'ONLINE',
        ) &&
        (await specialProviderAccount(
          tx,
          order.tenantId,
          specialOrderMarket(order.commercialTerms),
          order.currency,
        ))
      ) {
        await notify(
          tx,
          order.tenantId,
          order.requestId,
          order.customerId,
          'SPECIAL_ORDER_BALANCE_AVAILABLE',
          operation.id,
        );
      }
    }
    return sourcingProgress(await load(tx, scope, id), true);
  });
}
