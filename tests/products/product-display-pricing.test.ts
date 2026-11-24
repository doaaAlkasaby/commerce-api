import { describe, expect, it } from 'vitest';
import { mapProductListItem } from '../../src/modules/products/product.mapper.js';
import { seedTask11Products } from '../../prisma/seeds/task11-products.seed.js';
import { seedTenants } from '../../prisma/seeds/tenants.seed.js';
import { seedCatalog } from '../../prisma/seeds/catalog.seed.js';
import { testPrisma } from '../../src/config/test-database.js';
import { ProductRepository } from '../../src/modules/products/product.repository.js';
import { ProductService } from '../../src/modules/products/product.service.js';

describe('Product Listing Display Pricing Unit & Integration Tests', () => {
  it('1. mapProductListItem unit test: variant discount takes precedence over product discount', () => {
    const product = {
      tenant: { defaultCurrency: 'KWD' },
      id: 'prod-1',
      name: 'Test Shirt',
      slug: 'test-shirt',
      description: 'A test shirt',
      status: 'ACTIVE' as const,
      basePrice: '20.000',
      discountType: 'PERCENTAGE' as const,
      discountValue: '10',
      discountStartsAt: null,
      discountEndsAt: null,
      primaryImage: null,
      category: { id: 'cat-1', name: 'Clothing', slug: 'clothing' },
      brand: null,
      rating: { average: 5, count: 1 },
      isInWishlist: false,
      images: [],
      variants: [
        {
          id: 'var-1',
          price: '20.000',
          discountType: 'PERCENTAGE' as const,
          discountValue: '25', // 25% variant discount > 10% product discount
          discountStartsAt: null,
          discountEndsAt: null,
          isDefault: true,
          isActive: true,
        },
      ],
      hasVariants: false,
      defaultVariantId: 'var-1',
    };

    const mapped = mapProductListItem(
      product as unknown as Parameters<typeof mapProductListItem>[0],
    );

    expect(mapped.basePrice).toBe('20.000');
    expect(mapped.discountType).toBe('PERCENTAGE'); // Raw product table field preserved
    expect(mapped.discountValue).toBe('10');
    expect(mapped.displayPricing).toEqual({
      originalPrice: '20.000',
      finalPrice: '15.000', // 25% off 20.000 = 15.000
      discountType: 'PERCENTAGE',
      discountValue: '25',
      discountAmount: '5.000',
      discountPercentage: 25,
    });
  });

  it('2. mapProductListItem unit test: expired variant discount falls back to active product discount', () => {
    const expiredDate = new Date('2020-01-01');
    const product = {
      tenant: { defaultCurrency: 'KWD' },
      id: 'prod-2',
      name: 'Test Jacket',
      slug: 'test-jacket',
      description: 'A test jacket',
      status: 'ACTIVE' as const,
      basePrice: '50.000',
      discountType: 'PERCENTAGE' as const,
      discountValue: '20', // Active product discount 20%
      discountStartsAt: null,
      discountEndsAt: null,
      primaryImage: null,
      category: { id: 'cat-1', name: 'Clothing', slug: 'clothing' },
      brand: null,
      rating: { average: 0, count: 0 },
      isInWishlist: false,
      images: [],
      variants: [
        {
          id: 'var-1',
          price: '50.000',
          discountType: 'PERCENTAGE' as const,
          discountValue: '50',
          discountStartsAt: expiredDate,
          discountEndsAt: expiredDate, // Expired
          isDefault: true,
          isActive: true,
        },
      ],
      hasVariants: false,
      defaultVariantId: 'var-1',
    };

    const mapped = mapProductListItem(
      product as unknown as Parameters<typeof mapProductListItem>[0],
    );

    expect(mapped.displayPricing).toEqual({
      originalPrice: '50.000',
      finalPrice: '40.000', // Falls back to product 20% discount (50 - 10 = 40)
      discountType: 'PERCENTAGE',
      discountValue: '20',
      discountAmount: '10.000',
      discountPercentage: 20,
    });
  });

  it('3. mapProductListItem unit test: product without variants or discounts', () => {
    const product = {
      tenant: { defaultCurrency: 'KWD' },
      id: 'prod-3',
      name: 'Plain Hat',
      slug: 'plain-hat',
      description: 'Simple hat',
      status: 'ACTIVE' as const,
      basePrice: '10.000',
      discountType: null,
      discountValue: null,
      discountStartsAt: null,
      discountEndsAt: null,
      primaryImage: null,
      category: { id: 'cat-1', name: 'Clothing', slug: 'clothing' },
      brand: null,
      rating: { average: 0, count: 0 },
      isInWishlist: false,
      images: [],
      variants: [],
      hasVariants: false,
      defaultVariantId: null,
    };

    const mapped = mapProductListItem(
      product as unknown as Parameters<typeof mapProductListItem>[0],
    );

    expect(mapped.displayPricing).toEqual({
      originalPrice: '10.000',
      finalPrice: '10.000',
      discountType: null,
      discountValue: '0.00',
      discountAmount: '0.000',
      discountPercentage: null,
    });
  });

  it('4. Integration test: Product Service list() for Luma Linen Shirt returns displayPricing of 15.200 KWD', async () => {
    await seedTenants(testPrisma);
    await seedCatalog(testPrisma);

    const luma = await testPrisma.tenant.findUnique({ where: { slug: 'dev81-kuwait-fashion' } });
    if (luma) {
      await testPrisma.inventory.deleteMany({ where: { tenantId: luma.id } });
      await testPrisma.taxCategory.upsert({
        where: { tenantId_code: { tenantId: luma.id, code: 'STANDARD' } },
        update: { isActive: true },
        create: {
          tenantId: luma.id,
          code: 'STANDARD',
          name: 'Standard Tax',
          isActive: true,
        },
      });
    }

    await seedTask11Products(testPrisma);

    const repo = new ProductRepository(testPrisma);
    const service = new ProductService(repo);

    const result = await service.list(luma!.id, {
      page: 1,
      limit: 10,
      search: 'Luma Premium Linen Shirt',
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });

    expect(result.items.length).toBeGreaterThan(0);
    const shirtItem = result.items.find((i) => i.slug === 'luma-premium-linen-shirt');
    expect(shirtItem).toBeDefined();

    // Verify raw product-level fields preserved for backward compatibility
    expect(Number(shirtItem?.basePrice)).toBe(19);
    expect(shirtItem?.discountType).toBeNull();
    expect(shirtItem?.discountValue).toBeNull();

    // Verify Requirement 10: originalPrice 19.000, finalPrice 15.200, discountPercentage 20
    expect(shirtItem?.displayPricing).toEqual({
      originalPrice: '19.000',
      finalPrice: '15.200',
      discountType: 'PERCENTAGE',
      discountValue: '20',
      discountAmount: '3.800',
      discountPercentage: 20,
    });
  }, 30000);
});
