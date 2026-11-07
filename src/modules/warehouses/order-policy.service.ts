import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { toMinorUnits, validateAmount } from '../../common/pricing/money.js';
import type { TenantOrderPolicy } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';
import { OrderPolicyRepository } from './order-policy.repository.js';

const amount = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/)
  .nullable()
  .optional();
const quantity = z
  .number()
  .int()
  .positive()
  .max(2147483647)
  .nullable()
  .optional();
export const orderPolicySchema = z
  .object({
    minOrderAmount: amount,
    maxOrderAmount: amount,
    maxOrderItems: quantity,
    maxDistinctItems: quantity,
    maxQuantityPerItem: quantity,
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, 'Provide an update');

export function enforceOrderPolicy(
  policy: TenantOrderPolicy | null,
  items: ReadonlyArray<{ quantity: number }>,
  currency: string,
  merchandise?: bigint,
) {
  if (!policy) return;
  const fail = (code: string) => {
    throw new AppError('Tenant order limit exceeded', 409, code);
  };
  if (
    policy.maxOrderItems != null &&
    items.reduce((sum, item) => sum + BigInt(item.quantity), 0n) >
      BigInt(policy.maxOrderItems)
  )
    fail('ORDER_MAX_ITEMS_EXCEEDED');
  if (policy.maxDistinctItems != null && items.length > policy.maxDistinctItems)
    fail('ORDER_MAX_DISTINCT_ITEMS_EXCEEDED');
  const maximumQuantity = policy.maxQuantityPerItem;
  if (
    maximumQuantity != null &&
    items.some((item) => item.quantity > maximumQuantity)
  )
    fail('ORDER_MAX_QUANTITY_PER_ITEM_EXCEEDED');
  if (merchandise !== undefined) {
    if (
      policy.minOrderAmount != null &&
      merchandise < toMinorUnits(policy.minOrderAmount.toString(), currency)
    )
      fail('ORDER_MIN_AMOUNT_NOT_MET');
    if (
      policy.maxOrderAmount != null &&
      merchandise > toMinorUnits(policy.maxOrderAmount.toString(), currency)
    )
      fail('ORDER_MAX_AMOUNT_EXCEEDED');
  }
}

export class OrderPolicyService {
  async get(tenantId: string) {
    const repository = new OrderPolicyRepository(prisma);
    const [policy, tenant] = await Promise.all([
      repository.find(tenantId),
      repository.tenant(tenantId),
    ]);
    return {
      currency: tenant.defaultCurrency,
      minOrderAmount: policy?.minOrderAmount?.toString() ?? null,
      maxOrderAmount: policy?.maxOrderAmount?.toString() ?? null,
      maxOrderItems: policy?.maxOrderItems ?? null,
      maxDistinctItems: policy?.maxDistinctItems ?? null,
      maxQuantityPerItem: policy?.maxQuantityPerItem ?? null,
    };
  }
  async update(tenantId: string, input: z.infer<typeof orderPolicySchema>) {
    await prisma.$transaction(async (tx) => {
      const repository = new OrderPolicyRepository(tx);
      await repository.lock(tenantId);
      const tenant = await repository.tenant(tenantId);
      if (!tenant.defaultCurrency)
        throw new AppError(
          'Tenant currency is required',
          409,
          'TENANT_CURRENCY_NOT_CONFIGURED',
        );
      for (const value of [input.minOrderAmount, input.maxOrderAmount])
        if (value != null) validateAmount(value, tenant.defaultCurrency);
      const previous = await repository.find(tenantId);
      const min =
        input.minOrderAmount !== undefined
          ? input.minOrderAmount
          : previous?.minOrderAmount;
      const max =
        input.maxOrderAmount !== undefined
          ? input.maxOrderAmount
          : previous?.maxOrderAmount;
      if (
        min != null &&
        max != null &&
        toMinorUnits(min.toString(), tenant.defaultCurrency) >
          toMinorUnits(max.toString(), tenant.defaultCurrency)
      )
        throw new AppError(
          'Maximum amount must not be below minimum',
          400,
          'ORDER_POLICY_INVALID_RANGE',
        );
      await repository.save(tenantId, {
        ...(input.minOrderAmount !== undefined
          ? { minOrderAmount: input.minOrderAmount }
          : {}),
        ...(input.maxOrderAmount !== undefined
          ? { maxOrderAmount: input.maxOrderAmount }
          : {}),
        ...(input.maxOrderItems !== undefined
          ? { maxOrderItems: input.maxOrderItems }
          : {}),
        ...(input.maxDistinctItems !== undefined
          ? { maxDistinctItems: input.maxDistinctItems }
          : {}),
        ...(input.maxQuantityPerItem !== undefined
          ? { maxQuantityPerItem: input.maxQuantityPerItem }
          : {}),
      });
    });
    return this.get(tenantId);
  }
}
