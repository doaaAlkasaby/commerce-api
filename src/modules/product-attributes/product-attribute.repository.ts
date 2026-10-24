import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export const productAttributeDetailsSelect = {
  id: true,
  productId: true,
  name: true,
  sortOrder: true,
  values: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      attributeId: true,
      value: true,
      sortOrder: true,
      imageStorageKey: true,
      imageUrl: true,
    },
  },
} satisfies Prisma.ProductAttributeSelect;

export type ProductAttributeDetails = Awaited<
  ReturnType<ProductAttributeRepository['findById']>
>;

export class ProductAttributeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.productAttribute.findUnique({
      where: { id },
      select: productAttributeDetailsSelect,
    });
  }

  async findByProductId(productId: string) {
    return this.prisma.productAttribute.findMany({
      where: {
        productId,
      },

      orderBy: { sortOrder: 'asc' },

      select: productAttributeDetailsSelect,
    });
  }

  async findByProductAndName(productId: string, name: string) {
    return this.prisma.productAttribute.findUnique({
      where: {
        productId_name: {
          productId,
          name,
        },
      },

      select: productAttributeDetailsSelect,
    });
  }

  async create(data: { productId: string; name: string; sortOrder: number }) {
    return this.prisma.productAttribute.create({
      data: {
        productId: data.productId,
        name: data.name,
        sortOrder: data.sortOrder,
      },

      select: productAttributeDetailsSelect,
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      sortOrder?: number;
    },
  ) {
    return this.prisma.productAttribute.update({
      where: { id },

      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),

        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },

      select: productAttributeDetailsSelect,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.productAttribute.delete({
      where: { id },
    });
  }

  async findValueById(valueId: string) {
    return this.prisma.productAttributeValue.findUnique({
      where: {
        id: valueId,
      },

      select: {
        id: true,
        attributeId: true,
        value: true,
        sortOrder: true,
        imageStorageKey: true,
        imageUrl: true,

        attribute: {
          select: {
            id: true,
            productId: true,
            name: true,
          },
        },
      },
    });
  }

  async findValueByAttributeAndValue(attributeId: string, value: string) {
    return this.prisma.productAttributeValue.findUnique({
      where: {
        attributeId_value: {
          attributeId,
          value,
        },
      },
    });
  }

  async createValue(data: {
    attributeId: string;
    value: string;
    sortOrder: number;
  }) {
    return this.prisma.productAttributeValue.create({
      data: {
        attributeId: data.attributeId,
        value: data.value,
        sortOrder: data.sortOrder,
      },

      select: {
        id: true,
        attributeId: true,
        value: true,
        sortOrder: true,
        imageStorageKey: true,
        imageUrl: true,
      },
    });
  }

  async updateValue(
    valueId: string,
    data: {
      value?: string;
      sortOrder?: number;
    },
  ) {
    return this.prisma.productAttributeValue.update({
      where: {
        id: valueId,
      },

      data: {
        ...(data.value !== undefined ? { value: data.value } : {}),

        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },

      select: {
        id: true,
        attributeId: true,
        value: true,
        sortOrder: true,
        imageStorageKey: true,
        imageUrl: true,
      },
    });
  }

  async deleteValue(valueId: string): Promise<void> {
    await this.prisma.productAttributeValue.delete({
      where: {
        id: valueId,
      },
    });
  }

  async setValueImage(
    valueId: string,
    imageStorageKey: string,
    imageUrl: string,
  ) {
    return this.prisma.productAttributeValue.update({
      where: {
        id: valueId,
      },

      data: {
        imageStorageKey,
        imageUrl,
      },

      select: {
        id: true,
        attributeId: true,
        value: true,
        sortOrder: true,
        imageStorageKey: true,
        imageUrl: true,
      },
    });
  }

  async clearValueImage(valueId: string) {
    return this.prisma.productAttributeValue.update({
      where: {
        id: valueId,
      },

      data: {
        imageStorageKey: null,
        imageUrl: null,
      },

      select: {
        id: true,
        attributeId: true,
        value: true,
        sortOrder: true,
        imageStorageKey: true,
        imageUrl: true,
      },
    });
  }

  async countVariantsUsingAttributeValue(
    attributeValueId: string,
  ): Promise<number> {
    return this.prisma.productVariantValue.count({
      where: {
        attributeValueId,
      },
    });
  }
}
