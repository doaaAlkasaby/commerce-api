import { AppError } from '../../common/errors/app-error.js';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export const productAttributeDetailsSelect = {
  id: true, productId: true, name: true, sortOrder: true,
  values: { orderBy: { sortOrder: 'asc' }, select: {
    id: true, attributeId: true, value: true, sortOrder: true,
    imageStorageKey: true, imageUrl: true,
  } },
} satisfies Prisma.ProductAttributeSelect;

export type ProductAttributeDetails = Awaited<ReturnType<ProductAttributeRepository['findById']>>;
const valueSelect = { id: true, attributeId: true, value: true, sortOrder: true, imageStorageKey: true, imageUrl: true } as const;
const tenantAttribute = (tenantId: string) => ({ product: { tenantId } });
const tenantValue = (tenantId: string) => ({ attribute: { product: { tenantId } } });

export class ProductAttributeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(tenantId: string, id: string) {
    return this.prisma.productAttribute.findFirst({ where: { id, ...tenantAttribute(tenantId) }, select: productAttributeDetailsSelect });
  }
  async findByProductId(tenantId: string, productId: string) {
    return this.prisma.productAttribute.findMany({ where: { productId, ...tenantAttribute(tenantId) }, orderBy: { sortOrder: 'asc' }, select: productAttributeDetailsSelect });
  }
  async findByProductAndName(tenantId: string, productId: string, name: string) {
    return this.prisma.productAttribute.findFirst({ where: { productId, name, ...tenantAttribute(tenantId) }, select: productAttributeDetailsSelect });
  }
  async create(tenantId: string, data: { productId: string; name: string; sortOrder: number }) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Product"
        WHERE "id" = ${data.productId} AND "tenantId" = ${tenantId}
        FOR UPDATE
      `;
      if (!locked.length) return null;
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
          'Simple products with a default SKU cannot add attributes',
          409,
          'SIMPLE_PRODUCT_HAS_DEFAULT_VARIANT',
        );
      }
      return tx.productAttribute.create({ data, select: productAttributeDetailsSelect });
    });
  }
  async update(tenantId: string, id: string, data: { name?: string; sortOrder?: number }) {
    const owned = await this.prisma.productAttribute.findFirst({ where: { id, ...tenantAttribute(tenantId) }, select: { id: true } });
    if (!owned) return null;
    return this.prisma.productAttribute.update({ where: { id: owned.id }, data, select: productAttributeDetailsSelect });
  }
  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prisma.productAttribute.deleteMany({ where: { id, ...tenantAttribute(tenantId) } });
    return result.count > 0;
  }
  async findValueById(tenantId: string, valueId: string) {
    return this.prisma.productAttributeValue.findFirst({ where: { id: valueId, ...tenantValue(tenantId) }, select: {
      ...valueSelect, attribute: { select: { id: true, productId: true, name: true } },
    } });
  }
  async findValueByAttributeAndValue(tenantId: string, attributeId: string, value: string) {
    return this.prisma.productAttributeValue.findFirst({ where: { attributeId, value, ...tenantValue(tenantId) } });
  }
  async createValue(tenantId: string, data: { attributeId: string; value: string; sortOrder: number }) {
    const attribute = await this.prisma.productAttribute.findFirst({ where: { id: data.attributeId, ...tenantAttribute(tenantId) }, select: { id: true } });
    if (!attribute) return null;
    return this.prisma.productAttributeValue.create({ data, select: valueSelect });
  }
  async updateValue(tenantId: string, valueId: string, data: { value?: string; sortOrder?: number }) {
    const owned = await this.prisma.productAttributeValue.findFirst({ where: { id: valueId, ...tenantValue(tenantId) }, select: { id: true } });
    if (!owned) return null;
    return this.prisma.productAttributeValue.update({ where: { id: owned.id }, data, select: valueSelect });
  }
  async deleteValue(tenantId: string, valueId: string): Promise<boolean> {
    const result = await this.prisma.productAttributeValue.deleteMany({ where: { id: valueId, ...tenantValue(tenantId) } });
    return result.count > 0;
  }
  async setValueImage(tenantId: string, valueId: string, imageStorageKey: string, imageUrl: string) {
    const owned = await this.prisma.productAttributeValue.findFirst({ where: { id: valueId, ...tenantValue(tenantId) }, select: { id: true } });
    if (!owned) return null;
    return this.prisma.productAttributeValue.update({ where: { id: owned.id }, data: { imageStorageKey, imageUrl }, select: valueSelect });
  }
  async clearValueImage(tenantId: string, valueId: string) {
    const owned = await this.prisma.productAttributeValue.findFirst({ where: { id: valueId, ...tenantValue(tenantId) }, select: { id: true } });
    if (!owned) return null;
    return this.prisma.productAttributeValue.update({ where: { id: owned.id }, data: { imageStorageKey: null, imageUrl: null }, select: valueSelect });
  }
  async countVariantsUsingAttributeValue(tenantId: string, attributeValueId: string): Promise<number> {
    return this.prisma.productVariantValue.count({ where: {
      attributeValueId,
      attributeValue: tenantValue(tenantId),
      variant: { product: { tenantId } },
    } });
  }
}
