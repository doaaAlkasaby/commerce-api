import { prisma } from '../../config/database.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { MerchantProductQuery } from './merchant-product.schemas.js';

const relation = { id: true, name: true, slug: true } as const;
const pricing = {
  discountType: true,
  discountValue: true,
  discountStartsAt: true,
  discountEndsAt: true,
} as const;
const variant = {
  id: true,
  sku: true,
  price: true,
  isActive: true,
  isDefault: true,
  ...pricing,
} as const;
const image = {
  id: true,
  url: true,
  altText: true,
  isPrimary: true,
  sortOrder: true,
} as const;
const imageOrder = [
  { isPrimary: 'desc' },
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductImageOrderByWithRelationInput[];
const summary = {
  id: true,
  name: true,
  slug: true,
  status: true,
  basePrice: true,
  ...pricing,
  createdAt: true,
  updatedAt: true,
  category: { select: relation },
  brand: { select: relation },
  tenant: { select: { defaultCurrency: true } },
  images: { select: image, orderBy: imageOrder, take: 1 },
} satisfies Prisma.ProductSelect;

const variantOrder = [
  { isDefault: 'desc' },
  { sku: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ProductVariantOrderByWithRelationInput[];

function inventory(tenantId: string) {
  return {
    where: { tenantId, warehouse: { tenantId } },
    orderBy: { warehouseId: 'asc' },
    select: {
      quantity: true,
      reservedQuantity: true,
      warehouse: { select: { id: true, name: true, isActive: true } },
    },
  } satisfies Prisma.ProductVariant$inventoryArgs;
}

export async function listMerchantProducts(
  tenantId: string,
  query: MerchantProductQuery,
) {
  const {
    page,
    limit,
    status,
    search,
    categoryId,
    brandId,
    sortBy,
    sortOrder,
  } = query;
  const contains = { contains: search ?? '', mode: 'insensitive' } as const;
  const where: Prisma.ProductWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(brandId ? { brandId } : {}),
    ...(search
      ? { OR: [{ name: contains }, { variants: { some: { sku: contains } } }] }
      : {}),
  };
  const [items, total] = await prisma.$transaction(
    [
      prisma.product.findMany({
        where,
        select: {
          ...summary,
          variants: {
            select: { ...variant, inventory: inventory(tenantId) },
            orderBy: variantOrder,
          },
        },
        orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return { items, total };
}

export function findMerchantProduct(tenantId: string, id: string) {
  return prisma.product.findUnique({
    where: { id, tenantId },
    select: {
      ...summary,
      description: true,
      images: { select: image, orderBy: imageOrder },
      attributes: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          sortOrder: true,
          values: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, value: true, sortOrder: true, imageUrl: true },
          },
        },
      },
      variants: {
        orderBy: variantOrder,
        select: {
          ...variant,
          values: {
            select: {
              attributeValue: {
                select: {
                  id: true,
                  value: true,
                  attribute: {
                    select: { id: true, name: true },
                  },
                },
              },
            },
          },
          images: { select: image, orderBy: imageOrder },
          inventory: inventory(tenantId),
        },
      },
    },
  });
}
