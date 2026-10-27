import type { PrismaClient } from '../../generated/prisma/client.js';

import type {
  CreateBannerInput,
  UpdateBannerInput,
} from './banner.types.js';

export class BannerRepository {
  constructor(
    private readonly prisma: PrismaClient,
  ) {}

  async findMany(tenantId: string) {
    return this.prisma.banner.findMany({
      where: { tenantId },
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

  async findActive(tenantId: string) {
    const now = new Date();

    return this.prisma.banner.findMany({
      where: {
        tenantId,
        isActive: true,

        AND: [
          {
            OR: [
              {
                startsAt: null,
              },
              {
                startsAt: {
                  lte: now,
                },
              },
            ],
          },
          {
            OR: [
              {
                endsAt: null,
              },
              {
                endsAt: {
                  gte: now,
                },
              },
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
    return this.prisma.banner.findUnique({
      where: {
        id, tenantId,
      },
    });
  }

  async create(tenantId: string, input: CreateBannerInput) {
    return this.prisma.banner.create({
      data: {
        tenantId,
        title: input.title ?? null,
        subtitle: input.subtitle ?? null,

        imageStorageKey:
          input.imageStorageKey,

        imageUrl: input.imageUrl,

        mobileImageStorageKey:
          input.mobileImageStorageKey ?? null,

        mobileImageUrl:
          input.mobileImageUrl ?? null,

        targetType:
          input.targetType ?? 'NONE',

        targetId:
          input.targetId ?? null,

        actionUrl:
          input.actionUrl ?? null,

        sortOrder:
          input.sortOrder ?? 0,

        startsAt:
          input.startsAt ?? null,

        endsAt:
          input.endsAt ?? null,

        isActive:
          input.isActive ?? true,
      },
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateBannerInput,
  ) {
    return this.prisma.banner.update({
      where: {
        id, tenantId,
      },

      data: {
        ...(input.title !== undefined && {
          title: input.title,
        }),

        ...(input.subtitle !== undefined && {
          subtitle: input.subtitle,
        }),

        ...(input.imageStorageKey !== undefined && {
          imageStorageKey:
            input.imageStorageKey,
        }),

        ...(input.imageUrl !== undefined && {
          imageUrl: input.imageUrl,
        }),

        ...(input.mobileImageStorageKey !== undefined && {
          mobileImageStorageKey:
            input.mobileImageStorageKey,
        }),

        ...(input.mobileImageUrl !== undefined && {
          mobileImageUrl:
            input.mobileImageUrl,
        }),

        ...(input.targetType !== undefined && {
          targetType: input.targetType,
        }),

        ...(input.targetId !== undefined && {
          targetId: input.targetId,
        }),

        ...(input.actionUrl !== undefined && {
          actionUrl: input.actionUrl,
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

        ...(input.isActive !== undefined && {
          isActive: input.isActive,
        }),
      },
    });
  }

  async delete(tenantId: string, id: string) {
    return this.prisma.banner.deleteMany({
      where: {
        id, tenantId,
      },
    });
  }

  async productExists(tenantId: string, id: string) {
    const product =
      await this.prisma.product.findUnique({
        where: { id, tenantId },
        select: { id: true },
      });

    return Boolean(product);
  }

  async categoryExists(tenantId: string, id: string) {
    const category =
      await this.prisma.category.findUnique({
        where: { id, tenantId },
        select: { id: true },
      });

    return Boolean(category);
  }

  async collectionExists(tenantId: string, id: string) {
    const collection =
      await this.prisma.productCollection.findUnique({
        where: { id, tenantId },
        select: { id: true },
      });

    return Boolean(collection);
  }
}
