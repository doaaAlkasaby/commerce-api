import type { PrismaClient } from '../../generated/prisma/client.js';

const imageSelect = {
  id: true, variantId: true, storageKey: true, url: true, altText: true,
  sortOrder: true, isPrimary: true, createdAt: true, updatedAt: true,
} as const;

const tenantImageWhere = (tenantId: string) => ({ variant: { product: { tenantId } } });

export class ProductVariantImageRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(tenantId: string, id: string) {
    return this.prisma.productVariantImage.findFirst({
      where: { id, ...tenantImageWhere(tenantId) }, select: imageSelect,
    });
  }

  async findByVariantId(tenantId: string, variantId: string) {
    return this.prisma.productVariantImage.findMany({
      where: { variantId, ...tenantImageWhere(tenantId) },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: imageSelect,
    });
  }

  async create(tenantId: string, data: {
    variantId: string; storageKey: string; url: string; altText?: string | null;
    sortOrder: number; isPrimary: boolean;
  }) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: data.variantId, product: { tenantId } }, select: { id: true },
    });
    if (!variant) return null;
    return this.prisma.productVariantImage.create({
      data: { variantId: variant.id, storageKey: data.storageKey, url: data.url,
        altText: data.altText ?? null, sortOrder: data.sortOrder, isPrimary: data.isPrimary },
      select: imageSelect,
    });
  }

  async update(tenantId: string, id: string, data: { altText?: string | null; sortOrder?: number }) {
    const owned = await this.prisma.productVariantImage.findFirst({
      where: { id, ...tenantImageWhere(tenantId) }, select: { id: true },
    });
    if (!owned) return null;
    return this.prisma.productVariantImage.update({
      where: { id: owned.id }, data: {
        ...(data.altText !== undefined ? { altText: data.altText } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      }, select: imageSelect,
    });
  }

  async setPrimary(tenantId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const owned = await tx.productVariantImage.findFirst({
        where: { id, ...tenantImageWhere(tenantId) }, select: { id: true, variantId: true },
      });
      if (!owned) return null;
      await tx.productVariantImage.updateMany({
        where: { variantId: owned.variantId, ...tenantImageWhere(tenantId), isPrimary: true, NOT: { id } },
        data: { isPrimary: false },
      });
      return tx.productVariantImage.update({ where: { id: owned.id }, data: { isPrimary: true }, select: imageSelect });
    });
  }

  async delete(tenantId: string, id: string) {
    const owned = await this.prisma.productVariantImage.findFirst({
      where: { id, ...tenantImageWhere(tenantId) }, select: { id: true },
    });
    if (!owned) return null;
    return this.prisma.productVariantImage.delete({ where: { id: owned.id } });
  }
}
