import { AppError } from '../../common/errors/app-error.js';
import type {
  ShippingCalculationInput,
  ShippingCalculationResult,
} from '../../common/shipping/shipping.types.js';
import type { ShippingService } from '../../common/shipping/shipping.service.js';
import type { AllocationRepository } from './allocation.repository.js';

type Candidate = Awaited<
  ReturnType<AllocationRepository['candidates']>
>[number];
export interface Allocation {
  warehouse: Candidate;
  shipping: ShippingCalculationResult;
}

export class AllocationService {
  constructor(
    private readonly repository: AllocationRepository,
    private readonly shipping: ShippingService,
  ) {}
  async allocate(
    input: ShippingCalculationInput,
    items: ReadonlyArray<{ variantId: string; quantity: number }>,
  ): Promise<Allocation> {
    const options: Allocation[] = [];
    const candidates = await this.repository.candidates(
      input.tenantId,
      input.destination.countryCode,
      items.map((item) => item.variantId),
    );
    let shippingFailure: AppError | undefined;
    for (const warehouse of candidates) {
      if (
        !items.every((item) =>
          warehouse.inventory.some(
            (stock) =>
              stock.variantId === item.variantId &&
              stock.quantity - stock.reservedQuantity >= item.quantity,
          ),
        )
      )
        continue;
      try {
        const shipping = await this.shipping.calculate({
          ...input,
          origin: {
            latitude: warehouse.latitude?.toNumber() ?? null,
            longitude: warehouse.longitude?.toNumber() ?? null,
          },
        });
        options.push({ warehouse, shipping });
      } catch (error) {
        if (!(error instanceof AppError) || error.statusCode >= 500)
          throw error;
        shippingFailure = error;
      }
    }
    options.sort(
      (a, b) =>
        a.warehouse.priority - b.warehouse.priority ||
        (a.shipping.amountCents < b.shipping.amountCents
          ? -1
          : a.shipping.amountCents > b.shipping.amountCents
            ? 1
            : a.warehouse.code < b.warehouse.code
              ? -1
              : a.warehouse.code > b.warehouse.code
                ? 1
                : 0),
    );
    if (!options[0]) {
      if (candidates.length === 1) {
        if (shippingFailure) throw shippingFailure;
        throw new AppError(
          'Insufficient stock in the eligible warehouse',
          409,
          'INSUFFICIENT_STOCK',
        );
      }
      throw new AppError(
        'No single eligible warehouse can fulfill this cart',
        409,
        'NO_ELIGIBLE_FULFILLMENT_WAREHOUSE',
      );
    }
    return options[0];
  }
}
