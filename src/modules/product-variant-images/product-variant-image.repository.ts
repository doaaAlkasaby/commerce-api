import type { PrismaClient } from '../../generated/prisma/client.js';

const imageSelect = {
  id: true,
  variantId: true,
  storageKey: true,
  url: true,
  altText: true,
  sortOrder: true,
  isPrimary: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class ProductVariantImageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.productVariantImage.findUnique({
      where: { id },
      select: imageSelect,
    });
  }

  async findByVariantId(variantId: string) {
    return this.prisma.productVariantImage.findMany({
      where: {
        variantId,
      },

      orderBy: [
        {
          isPrimary: 'desc',
        },
        {
          sortOrder: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],

      select: imageSelect,
    });
  }

  async create(data: {
    variantId: string;
    storageKey: string;
    url: string;
    altText?: string | null;
    sortOrder: number;
    isPrimary: boolean;
  }) {
    return this.prisma.productVariantImage.create({
      data: {
        variantId: data.variantId,

        storageKey: data.storageKey,

        url: data.url,

        altText: data.altText ?? null,

        sortOrder: data.sortOrder,

        isPrimary: data.isPrimary,
      },

      select: imageSelect,
    });
  }

  async update(
    id: string,
    data: {
      altText?: string | null;
      sortOrder?: number;
    },
  ) {
    return this.prisma.productVariantImage.update({
      where: {
        id,
      },

      data: {
        ...(data.altText !== undefined
          ? {
              altText: data.altText,
            }
          : {}),

        ...(data.sortOrder !== undefined
          ? {
              sortOrder: data.sortOrder,
            }
          : {}),
      },

      select: imageSelect,
    });
  }

  async setPrimary(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const image = await tx.productVariantImage.findUnique({
        where: { id },

        select: {
          id: true,
          variantId: true,
        },
      });

      if (!image) {
        return null;
      }

      await tx.productVariantImage.updateMany({
        where: {
          variantId: image.variantId,

          isPrimary: true,

          NOT: {
            id,
          },
        },
        data: {
          isPrimary: false,
        },
      });

      return tx.productVariantImage.update({
        where: {
          id,
        },

        data: {
          isPrimary: true,
        },

        select: imageSelect,
      });
    });
  }

  async delete(id: string) {
    return this.prisma.productVariantImage.delete({
      where: {
        id,
      },
    });
  }
}
