import {
  validateTenantAmounts,
  validatePercentage,
} from '../../common/pricing/money.repository.js';
import { AppError } from '../../common/errors/app-error.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

import { productVariantDetailsSelect } from './product-variant.mapper.js';

export class ProductVariantRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(tenantId: string, id: string) {
    return this.prisma.productVariant.findFirst({
      where: { id, product: { tenantId } },
      select: productVariantDetailsSelect,
    });
  }

  async findBySku(tenantId: string, sku: string) {
    return this.prisma.productVariant.findFirst({
      where: { sku, product: { tenantId } },
      select: productVariantDetailsSelect,
    });
  }

  async findByCombination(
    tenantId: string,
    productId: string,
    combinationKey: string,
  ) {
    return this.prisma.productVariant.findFirst({
      where: {
        productId,
        combinationKey,
        product: { tenantId },
      },

      select: productVariantDetailsSelect,
    });
  }

  async create(data: {
    tenantId: string;
    productId: string;
    sku: string;
    price?: string | null;
    isActive: boolean;

    discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT' | null;

    discountValue?: string | null;
    discountStartsAt?: Date | null;
    discountEndsAt?: Date | null;

    combinationKey: string;

    attributeValueIds: string[];
    enforceOptionedInvariant?: boolean;
  }) {
    if (data.discountType === 'PERCENTAGE')
      validatePercentage(data.discountValue);
    await validateTenantAmounts(
      data.tenantId,
      [
        data.price,
        data.discountType === 'FIXED_AMOUNT' ? data.discountValue : undefined,
      ],
      this.prisma,
    );
    if (data.enforceOptionedInvariant) {
      return this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Product"
          WHERE "id" = ${data.productId} AND "tenantId" = ${data.tenantId}
          FOR UPDATE
        `;
        if (!locked.length)
          throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

        const optionlessDefault = await tx.productVariant.findFirst({
          where: {
            productId: data.productId,
            isDefault: true,
            values: { none: {} },
          },
          select: { id: true },
        });
        if (optionlessDefault) {
          throw new AppError(
            'Simple products with a default SKU cannot add optioned variants',
            409,
            'SIMPLE_PRODUCT_HAS_DEFAULT_VARIANT',
          );
        }

        const ownedValues = await tx.productAttributeValue.count({
          where: {
            id: { in: data.attributeValueIds },
            attribute: {
              productId: data.productId,
              product: { tenantId: data.tenantId },
            },
          },
        });
        if (ownedValues !== data.attributeValueIds.length) {
          throw new AppError(
            'One or more attribute values do not belong to this product',
            400,
            'INVALID_ATTRIBUTE_VALUES',
          );
        }

        const existingCombination = await tx.productVariant.findFirst({
          where: {
            productId: data.productId,
            combinationKey: data.combinationKey,
            product: { tenantId: data.tenantId },
          },
          select: { id: true },
        });
        if (existingCombination) {
          throw new AppError(
            'A variant with this attribute combination already exists',
            409,
            'DUPLICATE_VARIANT_COMBINATION',
          );
        }

        return tx.productVariant.create({
          data: {
            productId: data.productId,
            sku: data.sku,
            price: data.price ?? null,
            isActive: data.isActive,
            isDefault: false,
            discountType: data.discountType ?? null,
            discountValue: data.discountValue ?? null,
            discountStartsAt: data.discountStartsAt ?? null,
            discountEndsAt: data.discountEndsAt ?? null,
            combinationKey: data.combinationKey,
            values: {
              create: data.attributeValueIds.map((attributeValueId) => ({
                attributeValue: {
                  connect: { id: attributeValueId },
                },
              })),
            },
          },
          select: productVariantDetailsSelect,
        });
      });
    }
    const product = await this.prisma.product.findFirst({
      where: { id: data.productId, tenantId: data.tenantId },
      select: { id: true },
    });
    if (!product) throw new Error('Product does not belong to this tenant');
    if (data.attributeValueIds.length > 0) {
      const ownedValues = await this.prisma.productAttributeValue.count({
        where: {
          id: { in: data.attributeValueIds },
          attribute: {
            productId: product.id,
            product: { tenantId: data.tenantId },
          },
        },
      });
      if (ownedValues !== data.attributeValueIds.length) {
        throw new Error(
          'Attribute values do not belong to this tenant product',
        );
      }
    }
    return this.prisma.productVariant.create({
      data: {
        productId: data.productId,

        sku: data.sku,

        price: data.price ?? null,

        isActive: data.isActive,

        discountType: data.discountType ?? null,

        discountValue: data.discountValue ?? null,

        discountStartsAt: data.discountStartsAt ?? null,

        discountEndsAt: data.discountEndsAt ?? null,

        combinationKey: data.combinationKey,

        values: {
          create: data.attributeValueIds.map((attributeValueId) => ({
            attributeValue: {
              connect: {
                id: attributeValueId,
              },
            },
          })),
        },
      },

      select: productVariantDetailsSelect,
    });
  }

  async createDefault(data: {
    tenantId: string;
    productId: string;
    sku: string;
    price?: string | null;
    isActive: boolean;
    discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT' | null;
    discountValue?: string | null;
    discountStartsAt?: Date | null;
    discountEndsAt?: Date | null;
  }) {
    if (data.discountType === 'PERCENTAGE')
      validatePercentage(data.discountValue);
    await validateTenantAmounts(
      data.tenantId,
      [
        data.price,
        data.discountType === 'FIXED_AMOUNT' ? data.discountValue : undefined,
      ],
      this.prisma,
    );

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Product"
        WHERE "id" = ${data.productId} AND "tenantId" = ${data.tenantId}
        FOR UPDATE
      `;
      if (!locked.length)
        throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');

      const attributeCount = await tx.productAttribute.count({
        where: { productId: data.productId },
      });
      if (attributeCount > 0) {
        throw new AppError(
          'Cannot create a default SKU for a product with attributes',
          409,
          'PRODUCT_HAS_ATTRIBUTES',
        );
      }

      const existingVariants = await tx.productVariant.findMany({
        where: { productId: data.productId },
        select: {
          id: true,
          isDefault: true,
          _count: { select: { values: true } },
        },
      });
      if (
        existingVariants.some(
          (row) => row.isDefault || row._count.values === 0,
        )
      ) {
        throw new AppError(
          'A default SKU already exists for this product',
          409,
          'DEFAULT_VARIANT_ALREADY_EXISTS',
        );
      }
      if (existingVariants.length > 0) {
        throw new AppError(
          'Cannot create an optionless default SKU for a product that already has variants',
          409,
          'PRODUCT_HAS_VARIANTS',
        );
      }

      return tx.productVariant.create({
        data: {
          productId: data.productId,
          sku: data.sku,
          price: data.price ?? null,
          isActive: data.isActive,
          isDefault: true,
          discountType: data.discountType ?? null,
          discountValue: data.discountValue ?? null,
          discountStartsAt: data.discountStartsAt ?? null,
          discountEndsAt: data.discountEndsAt ?? null,
          combinationKey: 'DEFAULT',
        },
        select: productVariantDetailsSelect,
      });
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: {
      sku?: string;
      price?: string | null;
      isActive?: boolean;

      discountType?: 'PERCENTAGE' | 'FIXED_AMOUNT' | null;

      discountValue?: string | null;
      discountStartsAt?: Date | null;
      discountEndsAt?: Date | null;

      combinationKey?: string;

      attributeValueIds?: string[];
    },
  ) {
    if (data.discountType === 'PERCENTAGE')
      validatePercentage(data.discountValue);
    await validateTenantAmounts(
      tenantId,
      [
        data.price,
        data.discountType === 'FIXED_AMOUNT' ? data.discountValue : undefined,
      ],
      this.prisma,
    );
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.productVariant.findFirst({
        where: { id, product: { tenantId } },
        select: { id: true, productId: true },
      });
      if (!existing) throw new Error('Product variant not found');
      if (data.attributeValueIds) {
        const valueCount = await tx.productAttributeValue.count({
          where: {
            id: { in: data.attributeValueIds },
            attribute: { productId: existing.productId, product: { tenantId } },
          },
        });
        if (valueCount !== data.attributeValueIds.length) {
          throw new Error(
            'Attribute values do not belong to this tenant product',
          );
        }
        await tx.productVariantValue.deleteMany({
          where: {
            variantId: id,
          },
        });
      }

      return tx.productVariant.update({
        where: { id: existing.id },

        data: {
          ...(data.sku !== undefined
            ? {
                sku: data.sku,
              }
            : {}),

          ...(data.price !== undefined
            ? {
                price: data.price,
              }
            : {}),

          ...(data.isActive !== undefined
            ? {
                isActive: data.isActive,
              }
            : {}),

          ...(data.discountType !== undefined
            ? {
                discountType: data.discountType,
              }
            : {}),

          ...(data.discountValue !== undefined
            ? {
                discountValue: data.discountValue,
              }
            : {}),

          ...(data.discountStartsAt !== undefined
            ? {
                discountStartsAt: data.discountStartsAt,
              }
            : {}),

          ...(data.discountEndsAt !== undefined
            ? {
                discountEndsAt: data.discountEndsAt,
              }
            : {}),

          ...(data.combinationKey !== undefined
            ? {
                combinationKey: data.combinationKey,
              }
            : {}),

          ...(data.attributeValueIds
            ? {
                values: {
                  create: data.attributeValueIds.map((attributeValueId) => ({
                    attributeValue: {
                      connect: {
                        id: attributeValueId,
                      },
                    },
                  })),
                },
              }
            : {}),
        },

        select: productVariantDetailsSelect,
      });
    });
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.prisma.productVariant.deleteMany({
      where: {
        id,
        product: { tenantId },
      },
    });
  }
}
