import { AppError } from '../../common/errors/app-error.js';

import type { ProductVariantRepository } from './product-variant.repository.js';

import type { ProductRepository } from '../products/product.repository.js';

import { toProductVariantResponse } from './product-variant.mapper.js';

import type {
  CreateProductVariantInput,
  UpdateProductVariantInput,
} from './product-variant.types.js';

const normalizeIds = (ids: string[]): string[] => {
  return [...new Set(ids)].sort();
};

const buildCombinationKey = (attributeValueIds: string[]): string => {
  return normalizeIds(attributeValueIds).join(':');
};

const isPrismaUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'P2002';

export class ProductVariantService {
  constructor(
    private readonly repository: ProductVariantRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  private validateAttributeValues(
    attributeValues: Array<{
      id: string;
      attributeId: string;
      value: string;
    }>,
    requestedIds: string[],
  ): void {
    if (attributeValues.length !== requestedIds.length) {
      throw new AppError(
        'One or more attribute values do not belong to this product',
        400,
        'INVALID_ATTRIBUTE_VALUES',
      );
    }

    const attributeIds = new Set<string>();

    for (const attributeValue of attributeValues) {
      if (attributeIds.has(attributeValue.attributeId)) {
        throw new AppError(
          'A variant cannot contain more than one value from the same attribute',
          400,
          'MULTIPLE_VALUES_SAME_ATTRIBUTE',
        );
      }

      attributeIds.add(attributeValue.attributeId);
    }
  }

  private validateDiscount(
    discount:
      | {
          type: 'PERCENTAGE' | 'FIXED_AMOUNT';
          value: string;
          startsAt?: Date | null;
          endsAt?: Date | null;
        }
      | null
      | undefined,
  ): void {
    if (!discount) {
      return;
    }

    const amount = Number(discount.value);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError(
        'Discount value must be greater than zero',
        400,
        'INVALID_DISCOUNT',
      );
    }

    if (discount.type === 'PERCENTAGE' && amount > 100) {
      throw new AppError(
        'Percentage discount cannot exceed 100%',
        400,
        'INVALID_DISCOUNT',
      );
    }

    if (
      discount.startsAt &&
      discount.endsAt &&
      discount.startsAt > discount.endsAt
    ) {
      throw new AppError(
        'Discount end date must be after start date',
        400,
        'INVALID_DISCOUNT',
      );
    }
  }

  async create(tenantId: string, input: CreateProductVariantInput) {
    const product = await this.productRepository.findById(input.productId, tenantId);

    if (!product) {
      throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
    }

    const attributeValueIds = normalizeIds(input.attributeValueIds);

    const attributeValues =
      await this.productRepository.findAttributeValuesByIds(
        tenantId,
        input.productId,
        attributeValueIds,
      );

    this.validateAttributeValues(attributeValues, attributeValueIds);

    this.validateDiscount(input.discount);

    const combinationKey = buildCombinationKey(attributeValueIds);

    const existingCombination = await this.repository.findByCombination(
      tenantId,
      input.productId,
      combinationKey,
    );

    if (existingCombination) {
      throw new AppError(
        'A variant with this attribute combination already exists',
        409,
        'DUPLICATE_VARIANT_COMBINATION',
      );
    }

    const existingSku = await this.repository.findBySku(input.sku);

    if (existingSku) {
      throw new AppError(
        'A variant with this SKU already exists',
        409,
        'DUPLICATE_VARIANT_SKU',
      );
    }

    try {
      const variant = await this.repository.create({
        tenantId,
        productId: input.productId,

        sku: input.sku,

        price: input.price ?? null,

        isActive: input.isActive ?? true,

        discountType: input.discount?.type ?? null,

        discountValue: input.discount?.value ?? null,

        discountStartsAt: input.discount?.startsAt ?? null,

        discountEndsAt: input.discount?.endsAt ?? null,

        combinationKey,

        attributeValueIds,
      });

      return toProductVariantResponse(variant);
    } catch (error) {
      /*
       * The pre-checks above protect normal requests.
       *
       * The database unique constraints protect
       * concurrent requests.
       */
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'Variant combination or SKU already exists',
          409,
          'DUPLICATE_VARIANT',
        );
      }

      throw error;
    }
  }

  async getById(tenantId: string, id: string) {
    const variant = await this.repository.findById(tenantId, id);

    if (!variant) {
      throw new AppError(
        'Product variant not found',
        404,
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    }

    return toProductVariantResponse(variant);
  }

  async update(tenantId: string, id: string, input: UpdateProductVariantInput) {
    const existing = await this.repository.findById(tenantId, id);

    if (!existing) {
      throw new AppError(
        'Product variant not found',
        404,
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    }

    this.validateDiscount(input.discount);

    let combinationKey: string | undefined;

    let attributeValueIds: string[] | undefined;

    if (input.attributeValueIds !== undefined) {
      attributeValueIds = normalizeIds(input.attributeValueIds);

      const attributeValues =
        await this.productRepository.findAttributeValuesByIds(
          tenantId,
          existing.productId,
          attributeValueIds,
        );

      this.validateAttributeValues(attributeValues, attributeValueIds);

      combinationKey = buildCombinationKey(attributeValueIds);

      const duplicate = await this.repository.findByCombination(
        tenantId,
        existing.productId,
        combinationKey,
      );

      if (duplicate && duplicate.id !== id) {
        throw new AppError(
          'A variant with this attribute combination already exists',
          409,
          'DUPLICATE_VARIANT_COMBINATION',
        );
      }
    }

    if (input.sku !== undefined && input.sku !== existing.sku) {
      const duplicate = await this.repository.findBySku(input.sku);

      if (duplicate && duplicate.id !== id) {
        throw new AppError(
          'A variant with this SKU already exists',
          409,
          'DUPLICATE_VARIANT_SKU',
        );
      }
    }

    try {
      const updated = await this.repository.update(tenantId, id, {
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.discount !== undefined
          ? {
              discountType: input.discount?.type ?? null,
              discountValue: input.discount?.value ?? null,
              discountStartsAt: input.discount?.startsAt ?? null,
              discountEndsAt: input.discount?.endsAt ?? null,
            }
          : {}),
        ...(combinationKey !== undefined ? { combinationKey } : {}),
        ...(attributeValueIds !== undefined ? { attributeValueIds } : {}),
      });

      return toProductVariantResponse(updated);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        throw new AppError(
          'Variant combination or SKU already exists',
          409,
          'DUPLICATE_VARIANT',
        );
      }

      throw error;
    }
  }

  async delete(tenantId: string, id: string) {
    const existing = await this.repository.findById(tenantId, id);

    if (!existing) {
      throw new AppError(
        'Product variant not found',
        404,
        'PRODUCT_VARIANT_NOT_FOUND',
      );
    }

    /*
     * We intentionally don't silently delete
     * inventory/order history here.
     *
     * Later, once Orders exist, we will add a
     * stronger rule around deleting variants.
     */

    await this.repository.delete(tenantId, id);
  }
}
