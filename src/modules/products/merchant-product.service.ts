import { AppError } from '../../common/errors/app-error.js';
import { createPagination } from '../../common/pagination/pagination.js';
import {
  calculateEffectivePrice,
  toCents,
} from '../../common/pricing/pricing.service.js';
import {
  findMerchantProduct,
  listMerchantProducts,
} from './merchant-product.repository.js';
import type { MerchantProductQuery } from './merchant-product.schemas.js';

type Product = Awaited<
  ReturnType<typeof listMerchantProducts>
>['items'][number];
type Variant = Product['variants'][number];
function discount(row: Product | Variant) {
  return {
    type: row.discountType,
    value: row.discountValue?.toString() ?? null,
    startsAt: row.discountStartsAt,
    endsAt: row.discountEndsAt,
  };
}
const noDiscount = { type: null, value: null, startsAt: null, endsAt: null };
function price(product: Product, now: Date, variant?: Variant) {
  const currency = product.tenant.defaultCurrency;
  if (!currency) return null;
  return calculateEffectivePrice(
    variant?.price?.toString() ?? product.basePrice.toString(),
    discount(product),
    variant ? discount(variant) : noDiscount,
    now,
    currency,
  );
}
function summarize(product: Product, now: Date) {
  const active = product.variants.filter((row) => row.isActive);
  const computed = active.map((variant) => price(product, now, variant));
  const available = computed.flatMap((row) => (row ? [row.finalPrice] : []));
  const currency = product.tenant.defaultCurrency;
  const ordered = currency
    ? available.sort((a, b) => {
        const first = toCents(a, currency);
        const second = toCents(b, currency);
        return first < second ? -1 : first > second ? 1 : 0;
      })
    : available;
  const fallback = price(product, now)?.finalPrice ?? null;
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    status: product.status,
    basePrice: product.basePrice.toString(),
    currency: product.tenant.defaultCurrency,
    effectivePriceMin: ordered[0] ?? fallback,
    effectivePriceMax: ordered.at(-1) ?? fallback,
    category: product.category,
    brand: product.brand,
    thumbnail: product.images[0] ?? null,
    variantCount: product.variants.length,
    activeVariantCount: active.length,
    stockedVariantCount: active.filter(({ inventory }) =>
      inventory.some(
        ({ warehouse, quantity, reservedQuantity }) =>
          warehouse.isActive && quantity > reservedQuantity,
      ),
    ).length,
    defaultVariantId: product.variants.find((row) => row.isDefault)?.id ?? null,
    skuSummary: product.variants.slice(0, 3).map((row) => row.sku),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export async function getMerchantProductList(
  tenantId: string,
  query: MerchantProductQuery,
) {
  const { items, total } = await listMerchantProducts(tenantId, query);
  const now = new Date();
  return {
    items: items.map((row) => summarize(row, now)),
    pagination: createPagination(query.page, query.limit, total),
  };
}

export async function getMerchantProductDetail(tenantId: string, id: string) {
  const product = await findMerchantProduct(tenantId, id);
  if (!product)
    throw new AppError('Product not found', 404, 'PRODUCT_NOT_FOUND');
  const now = new Date();
  return {
    ...summarize(product, now),
    description: product.description,
    discount: discount(product),
    images: product.images,
    attributes: product.attributes,
    variants: product.variants.map((row) => ({
      id: row.id,
      sku: row.sku,
      isActive: row.isActive,
      isDefault: row.isDefault,
      price: row.price?.toString() ?? null,
      effectivePrice: price(product, now, row)?.finalPrice ?? null,
      discount: discount(row),
      images: row.images,
      options: row.values.map(({ attributeValue }) => ({
        attributeId: attributeValue.attribute.id,
        attributeName: attributeValue.attribute.name,
        valueId: attributeValue.id,
        value: attributeValue.value,
      })),
      inventory: row.inventory.map(
        ({ quantity, reservedQuantity, warehouse }) => ({
          warehouse,
          quantity,
          reservedQuantity,
          availableQuantity: quantity - reservedQuantity,
        }),
      ),
    })),
  };
}
