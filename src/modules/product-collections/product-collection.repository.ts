import type { PrismaClient } from '../../generated/prisma/client.js';

import type {
  CreateProductCollectionInput,
  UpdateProductCollectionInput,
  AddProductToCollectionInput,
  UpdateCollectionProductOrderInput,
} from './product-collection.types.js';

export class ProductCollectionRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findMany() {
    const now = new Date();

    return this.prisma.productCollection.findMany({
      where: {
        isActive: true,

        AND: [
          {
            OR: [
              { startsAt: null },
              { startsAt: { lte: now } },
            ],
          },
          {
            OR: [
              { endsAt: null },
              { endsAt: { gte: now } },
            ],
          },
        ],
      },

      orderBy: [
        {
          sortOrder: 'asc',
        },
        {
          createdAt: 'desc',
        },
      ],
    });
  }

  async findById(id: string) {
    return this.prisma.productCollection.findUnique({
      where: {
        id,
      },
    });
  }

  async findPublicById(id: string) {
    const now = new Date();

    return this.prisma.productCollection.findFirst({
      where: {
        id,
        isActive: true,

        AND: [
          {
            OR: [
              { startsAt: null },
              { startsAt: { lte: now } },
            ],
          },
          {
            OR: [
              { endsAt: null },
              { endsAt: { gte: now } },
            ],
          },
        ],
      },
    });
  }

  async findBySlug(slug: string) {
    return this.prisma.productCollection.findUnique({
      where: {
        slug,
      },

      select: {
        id: true,
      },
    });
  }

  async create(
    input: CreateProductCollectionInput,
  ) {
    return this.prisma.productCollection.create({
      data: {
        name: input.name,
        slug: input.slug,

        description:
          input.description ?? null,

        imageStorageKey:
          input.imageStorageKey ?? null,

        imageUrl:
          input.imageUrl ?? null,

        isActive:
          input.isActive ?? true,

        sortOrder:
          input.sortOrder ?? 0,

        startsAt:
          input.startsAt ?? null,

        endsAt:
          input.endsAt ?? null,
      },
    });
  }

  async update(
    id: string,
    input: UpdateProductCollectionInput,
  ) {
    return this.prisma.productCollection.update({
      where: {
        id,
      },

      data: {
        ...(input.name !== undefined && {
          name: input.name,
        }),

        ...(input.slug !== undefined && {
          slug: input.slug,
        }),

        ...(input.description !== undefined && {
          description: input.description,
        }),

        ...(input.imageStorageKey !== undefined && {
          imageStorageKey:
            input.imageStorageKey,
        }),

        ...(input.imageUrl !== undefined && {
          imageUrl: input.imageUrl,
        }),

        ...(input.isActive !== undefined && {
          isActive: input.isActive,
        }),

        ...(input.sortOrder !== undefined && {
          sortOrder: input.sortOrder,
        }),

        ...(input.startsAt !== undefined && {
          startsAt: input.startsAt,
        }),

        ...(input.endsAt !== undefined && {
          endsAt: input.endsAt,
        }),
      },
    });
  }

  async delete(id: string) {
    return this.prisma.productCollection.delete({
      where: {
        id,
      },
    });
  }

  async findProduct(productId: string) {
    return this.prisma.product.findUnique({
      where: {
        id: productId,
      },

      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
      },
    });
  }

  async findCollectionProduct(
    collectionId: string,
    productId: string,
  ) {
    return this.prisma.productCollectionItem.findUnique({
      where: {
        collectionId_productId: {
          collectionId,
          productId,
        },
      },
    });
  }

  async addProduct(
    collectionId: string,
    input: AddProductToCollectionInput,
  ) {
    return this.prisma.productCollectionItem.create({
      data: {
        collectionId,
        productId: input.productId,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async removeProduct(
    collectionId: string,
    productId: string,
  ) {
    return this.prisma.productCollectionItem.delete({
      where: {
        collectionId_productId: {
          collectionId,
          productId,
        },
      },
    });
  }

  async updateProductOrder(
    collectionId: string,
    productId: string,
    input: UpdateCollectionProductOrderInput,
  ) {
    return this.prisma.productCollectionItem.update({
      where: {
        collectionId_productId: {
          collectionId,
          productId,
        },
      },

      data: {
        sortOrder: input.sortOrder,
      },
    });
  }

  async findPublicBySlug(slug: string) {
  const now = new Date();

  return this.prisma.productCollection.findFirst({
    where: {
      slug,

      isActive: true,

      AND: [
        {
          OR: [
            { startsAt: null },
            { startsAt: { lte: now } },
          ],
        },
        {
          OR: [
            { endsAt: null },
            { endsAt: { gte: now } },
          ],
        },
      ],
    },
  });
}
}