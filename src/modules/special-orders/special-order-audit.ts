import { AppError } from '../../common/errors/app-error.js';
import {
  calculateSkip,
  createPagination,
} from '../../common/pagination/pagination.js';
import { prisma } from '../../config/database.js';
import type { Scope } from './special-order.service.js';

async function scopedOrder(scope: Scope, id: string) {
  const order = await prisma.specialOrder.findFirst({
    where: { ...scope, id },
    select: { id: true },
  });
  if (!order)
    throw new AppError(
      'Special order not found',
      404,
      'SPECIAL_ORDER_NOT_FOUND',
    );
}

type HistoryRow = {
  id: string | null;
  kind: 'OPERATION' | 'CORRECTION' | null;
  total: bigint;
};
export async function sourcingHistory(
  scope: Scope,
  id: string,
  page: number,
  limit: number,
) {
  await scopedOrder(scope, id);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<HistoryRow[]>`
      WITH history AS (
        SELECT id, 'OPERATION' AS kind, "createdAt" FROM "SpecialOrderSourcingOperation"
        WHERE "tenantId" = ${scope.tenantId} AND "orderId" = ${id}
        UNION ALL
        SELECT e.id, 'CORRECTION' AS kind, e."createdAt" FROM "SpecialOrderResolutionEvent" e
        JOIN "SpecialOrderSourcingCorrection" c ON c."eventId" = e.id
        WHERE e."tenantId" = ${scope.tenantId} AND e."orderId" = ${id}
      )
      SELECT page.id, page.kind, totals.total
      FROM (SELECT COUNT(*) AS total FROM history) totals
      LEFT JOIN LATERAL (
        SELECT id, kind, "createdAt" FROM history ORDER BY "createdAt" DESC, id DESC, kind DESC
        LIMIT ${limit} OFFSET ${calculateSkip(page, limit)}
      ) page ON true
      ORDER BY page."createdAt" DESC, page.id DESC, page.kind DESC
    `;
    const [operations, corrections] = await Promise.all([
      tx.specialOrderSourcingOperation.findMany({
        where: {
          tenantId: scope.tenantId,
          orderId: id,
          id: {
            in: rows.flatMap((row) =>
              row.kind === 'OPERATION' && row.id ? [row.id] : [],
            ),
          },
        },
        select: {
          id: true,
          action: true,
          actorId: true,
          createdAt: true,
          entries: {
            orderBy: { itemId: 'asc' },
            select: {
              id: true,
              itemId: true,
              quantity: true,
              inventory: { select: { id: true, warehouseId: true } },
            },
          },
        },
      }),
      tx.specialOrderResolutionEvent.findMany({
        where: {
          tenantId: scope.tenantId,
          orderId: id,
          id: {
            in: rows.flatMap((row) =>
              row.kind === 'CORRECTION' && row.id ? [row.id] : [],
            ),
          },
        },
        select: {
          id: true,
          actorId: true,
          createdAt: true,
          reason: true,
          evidence: true,
          correction: {
            select: {
              quantity: true,
              entry: {
                select: {
                  id: true,
                  itemId: true,
                  operationId: true,
                  inventory: { select: { id: true, warehouseId: true } },
                },
              },
            },
          },
        },
      }),
    ]);
    const users = await tx.user.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              [...operations, ...corrections].map((row) => row.actorId),
            ),
          ],
        },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    const actor = (actorId: string) => {
      const user = users.find((row) => row.id === actorId);
      return {
        id: actorId,
        displayName: user
          ? `${user.firstName} ${user.lastName}`.trim() || null
          : null,
      };
    };
    const events = new Map(
      operations.map(({ actorId, ...row }) => [
        row.id,
        { kind: 'OPERATION' as const, ...row, actor: actor(actorId) },
      ]),
    );
    const fixes = new Map(
      corrections.flatMap((row) => {
        if (!row.correction) return [];
        const evidence =
          row.evidence &&
          typeof row.evidence === 'object' &&
          !Array.isArray(row.evidence)
            ? row.evidence
            : {};
        return [
          [
            row.id,
            {
              kind: 'CORRECTION' as const,
              id: row.id,
              createdAt: row.createdAt,
              actor: actor(row.actorId),
              reason: row.reason,
              quantity: row.correction.quantity,
              entry: row.correction.entry,
              correction:
                typeof evidence.correction === 'string'
                  ? evidence.correction
                  : null,
              evidence:
                typeof evidence.evidence === 'string'
                  ? evidence.evidence
                  : null,
            },
          ] as const,
        ];
      }),
    );
    const items = rows.flatMap((row) => {
      if (!row.id) return [];
      const item =
        row.kind === 'OPERATION' ? events.get(row.id) : fixes.get(row.id);
      return item ? [item] : [];
    });
    return {
      items,
      pagination: createPagination(page, limit, Number(rows[0]?.total ?? 0)),
    };
  });
}

export async function reconcileOperation(
  scope: Scope,
  orderId: string,
  domain: 'SOURCING' | 'FULFILLMENT' | 'RESOLUTION' | 'REFUND',
  key: string,
) {
  await scopedOrder(scope, orderId);
  const where = { tenantId: scope.tenantId, orderId, key };
  const select = { id: true, action: true } as const;
  if (domain === 'SOURCING' || domain === 'FULFILLMENT') {
    const row =
      domain === 'SOURCING'
        ? await prisma.specialOrderSourcingOperation.findFirst({
            where,
            select,
          })
        : await prisma.specialOrderFulfillmentEvent.findFirst({
            where,
            select,
          });
    return {
      domain,
      status: row ? 'RECORDED' : 'NOT_FOUND',
      operation: row,
      refund: null,
    };
  }
  const event = await prisma.specialOrderResolutionEvent.findFirst({
    where: {
      ...where,
      action:
        domain === 'REFUND'
          ? 'REFUND_EXECUTE'
          : { notIn: ['REFUND_EXECUTE', 'REFUND_RESULT'] },
    },
    select: { ...select, evidence: true },
  });
  const operation = event && { id: event.id, action: event.action };
  if (!event || domain === 'RESOLUTION')
    return {
      domain,
      status: event ? 'RECORDED' : 'NOT_FOUND',
      operation,
      refund: null,
    };
  const evidence = event.evidence;
  const refundId =
    evidence &&
    typeof evidence === 'object' &&
    !Array.isArray(evidence) &&
    typeof evidence.refundId === 'string'
      ? evidence.refundId
      : null;
  const refund = refundId
    ? await prisma.specialOrderRefund.findFirst({
        where: { tenantId: scope.tenantId, orderId, id: refundId },
        select: { id: true, state: true, updatedAt: true },
      })
    : null;
  const status =
    !refund || refund.state === 'UNKNOWN'
      ? 'UNKNOWN'
      : refund.state === 'IN_PROGRESS'
        ? 'IN_PROGRESS'
        : 'RECORDED';
  return { domain, status, operation, refund };
}
