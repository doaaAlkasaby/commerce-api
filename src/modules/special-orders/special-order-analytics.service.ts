import type { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import {
  calculateSkip,
  createPagination,
} from '../../common/pagination/pagination.js';
import {
  currencyPrecision,
  isCurrencyCode,
} from '../../common/pricing/currency.js';
import { parseDecimal } from '../../common/pricing/money.js';
import { prisma } from '../../config/database.js';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  analyticsRangeSchema,
  demandAnalyticsSchema,
} from './special-order.schemas.js';

const day = 86_400_000;

function dateRange(query: z.infer<typeof analyticsRangeSchema>) {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(query.to ?? today);
  const from = new Date(
    query.from ?? new Date(end.getTime() - 29 * day).toISOString().slice(0, 10),
  );
  const until = new Date(end.getTime() + day);
  if (from >= until || until.getTime() - from.getTime() > 366 * day) {
    throw new AppError(
      'Analytics range must contain between 1 and 366 UTC days',
      400,
      'SPECIAL_ANALYTICS_RANGE_INVALID',
    );
  }
  return {
    from,
    until,
    response: {
      from: from.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      timezone: 'UTC',
    },
  };
}

function orderCohort(tenantId: string, from: Date, until: Date) {
  return Prisma.sql`SELECT * FROM "SpecialOrder"
    WHERE "tenantId" = ${tenantId} AND "createdAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "createdAt" < (${until.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
}

export async function operationalAnalytics(
  tenantId: string,
  query: z.infer<typeof analyticsRangeSchema>,
) {
  const { from, until, response: range } = dateRange(query);
  const [row] = await prisma.$queryRaw<Record<string, bigint>[]>`
    WITH request_cohort AS (
      SELECT r.status, (o.id IS NOT NULL) AS converted
      FROM "SpecialOrderRequest" r LEFT JOIN "SpecialOrder" o
        ON o."requestId" = r.id AND o."tenantId" = r."tenantId"
      WHERE r."tenantId" = ${tenantId} AND r."createdAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND r."createdAt" < (${until.toISOString()}::timestamptz AT TIME ZONE 'UTC')
    ), orders AS (${orderCohort(tenantId, from, until)})
    SELECT
      COUNT(*) AS submitted,
      COUNT(*) FILTER (WHERE status IN ('NEW', 'UNDER_REVIEW')) AS "awaitingReview",
      COUNT(*) FILTER (WHERE status = 'QUOTED') AS quoted,
      COUNT(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
      COUNT(*) FILTER (WHERE status = 'REJECTED') AS rejected,
      COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
      COUNT(*) FILTER (WHERE converted) AS "convertedRequests",
      (SELECT COUNT(*) FROM orders) AS "confirmedOrders",
      (SELECT COUNT(*) FROM orders WHERE "cancellationStatus" <> 'CANCELLED' AND state = 'SOURCING') AS sourcing,
      (SELECT COUNT(*) FROM orders WHERE "cancellationStatus" <> 'CANCELLED' AND state = 'READY_FOR_FULFILLMENT') AS ready,
      (SELECT COUNT(*) FROM orders WHERE "cancellationStatus" <> 'CANCELLED' AND state = 'SHIPPED') AS "awaitingDelivery",
      (SELECT COUNT(*) FROM orders WHERE "cancellationStatus" <> 'CANCELLED' AND state = 'AWAITING_PICKUP') AS "awaitingPickup",
      (SELECT COUNT(*) FROM orders WHERE "completedAt" IS NOT NULL) AS "completedOrders",
      (SELECT COUNT(*) FROM orders WHERE "cancellationStatus" = 'CANCELLED') AS "cancelledOrders",
      (SELECT COUNT(*) FROM "SpecialOrderReturn" WHERE "tenantId" = ${tenantId} AND "createdAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "createdAt" < (${until.toISOString()}::timestamptz AT TIME ZONE 'UTC')) AS "returnCasesOpened",
      (SELECT COUNT(*) FROM "SpecialOrderReturn" WHERE "tenantId" = ${tenantId} AND status = 'RECEIVED'
        AND receipt->>'receivedAt' >= ${from.toISOString()} AND receipt->>'receivedAt' < ${until.toISOString()}) AS "returnCasesReceived",
      (SELECT COUNT(*) FROM "SpecialOrderRefund" WHERE "tenantId" = ${tenantId} AND "createdAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "createdAt" < (${until.toISOString()}::timestamptz AT TIME ZONE 'UTC')) AS "refundsAllocated",
      (SELECT COUNT(*) FROM "SpecialOrderRefund" WHERE "tenantId" = ${tenantId} AND state = 'SETTLED'
        AND "updatedAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND "updatedAt" < (${until.toISOString()}::timestamptz AT TIME ZONE 'UTC')) AS "refundsSettled"
    FROM request_cohort
  `;
  const {
    submitted = 0,
    awaitingReview,
    quoted,
    accepted,
    rejected,
    cancelled,
    convertedRequests = 0,
    returnCasesOpened,
    returnCasesReceived,
    refundsAllocated,
    refundsSettled,
    ...orders
  } = Object.fromEntries(
    Object.entries(row ?? {}).map(([key, value]) => [key, Number(value)]),
  );
  return {
    range,
    requests: {
      submitted,
      awaitingReview,
      quoted,
      accepted,
      rejected,
      cancelled,
    },
    orders,
    activity: {
      returnCasesOpened,
      returnCasesReceived,
      refundsAllocated,
      refundsSettled,
    },
    conversion: {
      submittedRequests: submitted,
      convertedRequests,
      rate: submitted ? convertedRequests / submitted : 0,
    },
  };
}

type DemandRow = {
  productId: string | null;
  variantId: string | null;
  name: string | null;
  requestedQuantity: bigint | null;
  confirmedQuantity: bigint | null;
  suggestedConfirmedQuantity: bigint | null;
  fulfilledQuantity: bigint | null;
  total: bigint;
};

export async function productDemandAnalytics(
  tenantId: string,
  query: z.infer<typeof demandAnalyticsSchema>,
) {
  const { from, until, response: range } = dateRange(query);
  const { page, limit } = query;
  const rows = await prisma.$queryRaw<DemandRow[]>`
    WITH orders AS (${orderCohort(tenantId, from, until)}), lines AS (
      SELECT i."productId", i."variantId", i.name, i.quantity AS requested, 0 AS confirmed, 0 AS suggested, 0 AS fulfilled
      FROM "SpecialOrderRequest" r JOIN "SpecialOrderRequestItem" i ON i."requestId" = r.id
      WHERE r."tenantId" = ${tenantId} AND r."createdAt" >= (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC') AND r."createdAt" < (${until.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      UNION ALL
      SELECT i."productId", i."variantId", i.name, 0, i.quantity,
        CASE WHEN q.type = 'SUGGESTED' THEN i.quantity ELSE 0 END,
        CASE WHEN o.state IN ('DELIVERED', 'PICKED_UP') THEN i.quantity ELSE 0 END
      FROM orders o JOIN "SpecialOrderItem" i ON i."orderId" = o.id
      JOIN "SpecialOrderQuotationItem" q ON q.id = i."quotationItemId"
    ), normalized AS (
      SELECT "productId", "variantId",
        CASE WHEN "productId" IS NULL AND "variantId" IS NULL THEN
          LOWER(BTRIM(REGEXP_REPLACE(name, '[[:space:]]+', ' ', 'g')))
        END AS label,
        requested, confirmed, suggested, fulfilled
      FROM lines
    ), grouped AS (
      SELECT "productId", "variantId",
        CASE WHEN label ~ '(@|://|[[:digit:]][[:digit:] .()+-]{6,}[[:digit:]]|\\m(rx|prescription|patient|diagnosis|mrn)\\M|وصفة|مريض|تشخيص)' THEN NULL ELSE label END AS name,
        SUM(requested) AS "requestedQuantity", SUM(confirmed) AS "confirmedQuantity",
        SUM(suggested) AS "suggestedConfirmedQuantity", SUM(fulfilled) AS "fulfilledQuantity"
      FROM normalized
      GROUP BY 1, 2, 3
    ), totals AS (SELECT COUNT(*) AS total FROM grouped)
    SELECT page.*, totals.total FROM totals LEFT JOIN LATERAL (
      SELECT * FROM grouped ORDER BY "requestedQuantity" DESC, "confirmedQuantity" DESC,
        "productId" ASC NULLS LAST, "variantId" ASC NULLS LAST, name ASC NULLS LAST
      LIMIT ${limit} OFFSET ${calculateSkip(page, limit)}
    ) AS page ON true
  `;
  return {
    range,
    items: rows
      .filter((row) => row.requestedQuantity !== null)
      .map(({ total, name, productId, variantId, ...values }) => ({
        kind: productId || variantId ? 'CATALOG' : 'NON_CATALOG',
        productId,
        variantId,
        name,
        ...Object.fromEntries(
          Object.entries(values).map(([key, value]) => [key, Number(value)]),
        ),
      })),
    pagination: createPagination(page, limit, Number(rows[0]?.total ?? 0)),
  };
}

type FinancialRow = {
  currency: string;
  blockingFinancialConflicts: bigint;
} & Record<string, Prisma.Decimal | string | bigint | null>;

export async function financialAnalytics(
  tenantId: string,
  query: z.infer<typeof analyticsRangeSchema>,
) {
  const { from, until, response: range } = dateRange(query);
  const rows = await prisma.$queryRaw<FinancialRow[]>`
    WITH orders AS (${orderCohort(tenantId, from, until)}),
      obligations AS (
        SELECT p.id, p."tenantId", p."orderId", o.currency AS "orderCurrency"
        FROM "SpecialOrderPayment" p JOIN orders o ON p."orderId" = o.id AND p."tenantId" = o."tenantId"
      ), attempts AS (
        SELECT a.id, a."tenantId", p."orderId", p."orderCurrency", a."conflictCode"
        FROM "SpecialOrderPaymentAttempt" a JOIN obligations p ON a."obligationId" = p.id AND a."tenantId" = p."tenantId"
      ), settlements AS (
        SELECT a."orderId", a."orderCurrency", s.currency, s.amount, false AS cash
        FROM attempts a JOIN "SpecialOrderPaymentSettlement" s ON s."attemptId" = a.id AND s."tenantId" = a."tenantId"
        WHERE s.attributable
        UNION ALL
        SELECT p."orderId", p."orderCurrency", s.currency, s.amount, true
        FROM obligations p JOIN "SpecialOrderPaymentSettlement" s ON s."cashObligationId" = p.id AND s."tenantId" = p."tenantId"
        WHERE s.attributable
      ), collected_by_order AS (
        SELECT "orderId", SUM(amount) FILTER (WHERE currency = "orderCurrency") AS collected,
          BOOL_OR(currency <> "orderCurrency") AS "currencyConflict"
        FROM settlements GROUP BY "orderId"
      ), attempt_conflicts AS (
        SELECT DISTINCT "orderId" FROM attempts WHERE "conflictCode" IS NOT NULL
      ), order_totals AS (
        SELECT o.currency, SUM(o."grandTotal") AS "confirmedOrderValue",
          SUM(COALESCE((o.financials->>'sourcingFeeTotalIncludingTax')::numeric, 0)) AS "quotedSourcingFeesIncludingTax",
          SUM(COALESCE((o.financials->>'shippingTotalIncludingTax')::numeric, 0)) AS "quotedShippingIncludingTax",
          SUM(CASE WHEN o."cancellationStatus" = 'CANCELLED' THEN 0 ELSE GREATEST(o."grandTotal" - COALESCE(c.collected, 0), 0) END) AS outstanding,
          SUM(GREATEST(COALESCE(c.collected, 0) - o."grandTotal", 0)) AS overpaid,
          COUNT(*) FILTER (WHERE c."currencyConflict" OR a."orderId" IS NOT NULL
            OR o."fulfillmentDiscrepancy" IS NOT NULL OR c.collected > o."grandTotal") AS "blockingFinancialConflicts"
        FROM orders o LEFT JOIN collected_by_order c ON c."orderId" = o.id
        LEFT JOIN attempt_conflicts a ON a."orderId" = o.id GROUP BY o.currency
      ), collection_totals AS (
        SELECT currency, SUM(amount) FILTER (WHERE cash) AS "verifiedCashCollections",
          SUM(amount) FILTER (WHERE NOT cash) AS "verifiedOnlineCollections", SUM(amount) AS "verifiedCollections",
          SUM(amount) FILTER (WHERE currency <> "orderCurrency") AS "offCurrencyCollections"
        FROM settlements GROUP BY currency
      ), refund_totals AS (
        SELECT r.currency, SUM(r.amount) FILTER (WHERE r.state = 'SETTLED') AS "settledRefunds",
          SUM(r.amount) FILTER (WHERE r.state <> 'SETTLED') AS "refundDue"
        FROM orders o JOIN "SpecialOrderRefund" r ON r."orderId" = o.id AND r."tenantId" = o."tenantId"
        GROUP BY r.currency
      ), currencies AS (
        SELECT currency FROM order_totals UNION SELECT currency FROM collection_totals UNION SELECT currency FROM refund_totals
      )
      SELECT c.currency, o."confirmedOrderValue", o."quotedSourcingFeesIncludingTax", o."quotedShippingIncludingTax",
        o.outstanding, o.overpaid, COALESCE(o."blockingFinancialConflicts", 0) AS "blockingFinancialConflicts",
        s."verifiedCashCollections", s."verifiedOnlineCollections", s."verifiedCollections", s."offCurrencyCollections",
        r."settledRefunds", r."refundDue", COALESCE(s."verifiedCollections", 0) - COALESCE(r."settledRefunds", 0) AS "netCollected"
      FROM currencies c LEFT JOIN order_totals o USING (currency)
      LEFT JOIN collection_totals s USING (currency) LEFT JOIN refund_totals r USING (currency) ORDER BY c.currency
  `;
  return {
    range,
    byCurrency: rows.map(
      ({ currency, blockingFinancialConflicts, ...amounts }) => ({
        currency,
        blockingFinancialConflicts: Number(blockingFinancialConflicts),
        ...Object.fromEntries(
          Object.entries(amounts).map(([key, value]) => [
            key,
            (value === null
              ? parseDecimal('0')
              : (value as Prisma.Decimal)
            ).toFixed(
              isCurrencyCode(currency)
                ? currencyPrecision(currency)
                : undefined,
            ),
          ]),
        ),
      }),
    ),
  };
}
