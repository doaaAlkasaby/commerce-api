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

  async findMany(tenantId: string) {
    const now = new Date();

    return this.prisma.productCollection.findMany({
      where: {
        tenantId,
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

  async findById(tenantId: string, id: string) {
    return this.prisma.productCollection.findUnique({
      where: {
        id, tenantId,
      },
    });
  }

  async findPublicById(tenantId: string, id: string) {
    const now = new Date();

    return this.prisma.productCollection.findFirst({
      where: {
        id,
        tenantId,
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

  async findBySlug(tenantId: string, slug: string) {
    return this.prisma.productCollection.findUnique({
      where: {
        tenantId_slug: { tenantId, slug },
      },

      select: {
        id: true,
      },
    });
  }

  async create(
    tenantId: string,
    input: CreateProductCollectionInput,
  ) {
    return this.prisma.productCollection.create({
      data: {
        tenantId,
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
    tenantId: string,
    id: string,
    input: UpdateProductCollectionInput,
  ) {
    return this.prisma.productCollection.update({
      where: {
        id, tenantId,
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

  async delete(tenantId: string, id: string) {
    return this.prisma.productCollection.delete({
      where: {
        id, tenantId,
      },
    });
  }

  async findProduct(tenantId: string, productId: string) {
    return this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
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
    tenantId: string,
    collectionId: string,
    productId: string,
  ) {
    return this.prisma.productCollectionItem.findFirst({
      where: {
        collectionId, productId,
        collection: { tenantId },
        product: { tenantId },
      },
    });
  }

  async addProduct(
    tenantId: string,
    collectionId: string,
    input: AddProductToCollectionInput,
  ) {
    const [collection, product] = await Promise.all([
      this.prisma.productCollection.findFirst({ where: { id: collectionId, tenantId }, select: { id: true } }),
      this.prisma.product.findFirst({ where: { id: input.productId, tenantId }, select: { id: true } }),
    ]);
    if (!collection || !product) {
      throw new Error('Collection or product does not belong to this tenant');
    }
    return this.prisma.productCollectionItem.create({
      data: {
        collectionId,
        productId: input.productId,
        sortOrder: input.sortOrder ?? 0,
      },
    });
  }

  async removeProduct(
    tenantId: string,
    collectionId: string,
    productId: string,
  ) {
    return this.prisma.productCollectionItem.deleteMany({
      where: { collectionId, productId, collection: { tenantId }, product: { tenantId } },
    });
  }

  async updateProductOrder(
    tenantId: string,
    collectionId: string,
    productId: string,
    input: UpdateCollectionProductOrderInput,
  ) {
    const updated = await this.prisma.productCollectionItem.updateMany({
      where: { collectionId, productId, collection: { tenantId }, product: { tenantId } },

      data: {
        sortOrder: input.sortOrder,
      },
    });
    if (updated.count === 0) return null;
    return this.prisma.productCollectionItem.findFirst({
      where: { collectionId, productId, collection: { tenantId }, product: { tenantId } },
    });
  }

  async findPublicBySlug(tenantId: string, slug: string) {
  const now = new Date();

  return this.prisma.productCollection.findFirst({
    where: {
      slug,
      tenantId,

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
