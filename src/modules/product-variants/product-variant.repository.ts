import type {
  PrismaClient,
} from '../../generated/prisma/client.js';

import {
  productVariantDetailsSelect,
} from './product-variant.mapper.js';

export class ProductVariantRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findById(tenantId: string, id: string) {
    return this.prisma.productVariant.findFirst({
      where: { id, product: { tenantId } },
      select:
        productVariantDetailsSelect,
    });
  }

  async findBySku(tenantId: string, sku: string) {
    return this.prisma.productVariant.findFirst({
      where: { sku, product: { tenantId } },
      select:
        productVariantDetailsSelect,
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

      select:
        productVariantDetailsSelect,
    });
  }

  async create(data: {
    tenantId: string;
    productId: string;
    sku: string;
    price?: string | null;
    isActive: boolean;

    discountType?:
      | 'PERCENTAGE'
      | 'FIXED_AMOUNT'
      | null;

    discountValue?: string | null;
    discountStartsAt?: Date | null;
    discountEndsAt?: Date | null;

    combinationKey: string;

    attributeValueIds: string[];
  }) {
    const product = await this.prisma.product.findFirst({ where: { id: data.productId, tenantId: data.tenantId }, select: { id: true } });
    if (!product) throw new Error('Product does not belong to this tenant');
    if (data.attributeValueIds.length > 0) {
      const ownedValues = await this.prisma.productAttributeValue.count({
        where: {
          id: { in: data.attributeValueIds },
          attribute: { productId: product.id, product: { tenantId: data.tenantId } },
        },
      });
      if (ownedValues !== data.attributeValueIds.length) {
        throw new Error('Attribute values do not belong to this tenant product');
      }
    }
    return this.prisma.productVariant.create({
      data: {
        productId:
          data.productId,

        sku: data.sku,

        price:
          data.price ?? null,

        isActive:
          data.isActive,

        discountType:
          data.discountType ?? null,

        discountValue:
          data.discountValue ?? null,

        discountStartsAt:
          data.discountStartsAt ?? null,

        discountEndsAt:
          data.discountEndsAt ?? null,

        combinationKey:
          data.combinationKey,

        values: {
          create:
            data.attributeValueIds.map(
              (attributeValueId) => ({
                attributeValue: {
                  connect: {
                    id:
                      attributeValueId,
                  },
                },
              }),
            ),
        },
      },

      select:
        productVariantDetailsSelect,
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: {
      sku?: string;
      price?: string | null;
      isActive?: boolean;

      discountType?:
        | 'PERCENTAGE'
        | 'FIXED_AMOUNT'
        | null;

      discountValue?: string | null;
      discountStartsAt?: Date | null;
      discountEndsAt?: Date | null;

      combinationKey?: string;

      attributeValueIds?: string[];
    },
  ) {
    return this.prisma.$transaction(
      async (tx) => {
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
            throw new Error('Attribute values do not belong to this tenant product');
          }
          await tx.productVariantValue.deleteMany(
            {
              where: {
                variantId: id,
              },
            },
          );
        }

        return tx.productVariant.update({
          where: { id: existing.id },

          data: {
            ...(data.sku !== undefined
              ? {
                  sku:
                    data.sku,
                }
              : {}),

            ...(data.price !== undefined
              ? {
                  price:
                    data.price,
                }
              : {}),

            ...(data.isActive !== undefined
              ? {
                  isActive:
                    data.isActive,
                }
              : {}),

            ...(data.discountType !== undefined
              ? {
                  discountType:
                    data.discountType,
                }
              : {}),

            ...(data.discountValue !== undefined
              ? {
                  discountValue:
                    data.discountValue,
                }
              : {}),

            ...(data.discountStartsAt !== undefined
              ? {
                  discountStartsAt:
                    data.discountStartsAt,
                }
              : {}),

            ...(data.discountEndsAt !== undefined
              ? {
                  discountEndsAt:
                    data.discountEndsAt,
                }
              : {}),

            ...(data.combinationKey !== undefined
              ? {
                  combinationKey:
                    data.combinationKey,
                }
              : {}),

            ...(data.attributeValueIds
              ? {
                  values: {
                    create:
                      data.attributeValueIds.map(
                        (
                          attributeValueId,
                        ) => ({
                          attributeValue: {
                            connect: {
                              id:
                                attributeValueId,
                            },
                          },
                        }),
                      ),
                  },
                }
              : {}),
          },

          select:
            productVariantDetailsSelect,
        });
      },
    );
  }

  async delete(
    tenantId: string,
    id: string,
  ): Promise<void> {
    await this.prisma.productVariant.deleteMany({
      where: {
        id,
        product: { tenantId },
      },
    });
  }
}
