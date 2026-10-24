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

  async findById(id: string) {
    return this.prisma.productVariant.findUnique({
      where: { id },
      select:
        productVariantDetailsSelect,
    });
  }

  async findBySku(sku: string) {
    return this.prisma.productVariant.findUnique({
      where: { sku },
      select:
        productVariantDetailsSelect,
    });
  }

  async findByCombination(
    productId: string,
    combinationKey: string,
  ) {
    return this.prisma.productVariant.findUnique({
      where: {
        productId_combinationKey: {
          productId,
          combinationKey,
        },
      },

      select:
        productVariantDetailsSelect,
    });
  }

  async create(data: {
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
        if (
          data.attributeValueIds
        ) {
          await tx.productVariantValue.deleteMany(
            {
              where: {
                variantId: id,
              },
            },
          );
        }

        return tx.productVariant.update({
          where: {
            id,
          },

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
    id: string,
  ): Promise<void> {
    await this.prisma.productVariant.delete({
      where: {
        id,
      },
    });
  }
}