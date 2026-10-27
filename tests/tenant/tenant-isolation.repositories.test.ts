import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { ProductRepository } from '../../src/modules/products/product.repository.js';
import { CartRepository } from '../../src/modules/cart/cart.repository.js';

const makePrisma = () => ({
  product: {
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    update: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  category: { findUnique: vi.fn().mockResolvedValue(null) },
  brand: { findUnique: vi.fn().mockResolvedValue(null) },
  cart: {
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ id: 'cart-a' }),
  },
  cartItem: { findFirst: vi.fn().mockResolvedValue(null) },
}) as unknown as PrismaClient;

describe('tenant-scoped repository access', () => {
  it('scopes product ID and slug lookups to the tenant', async () => {
    const db = makePrisma();
    const repository = new ProductRepository(db);

    await repository.findById('product-b', 'tenant-a');
    await repository.findBySlug('same-slug', 'tenant-a');

    expect(db.product.findUnique).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ where: { id: 'product-b', tenantId: 'tenant-a' } }),
    );
    expect(db.product.findUnique).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ where: { tenantId_slug: { tenantId: 'tenant-a', slug: 'same-slug' } } }),
    );
  });

  it('scopes product listings, category validation, and brand validation', async () => {
    const db = makePrisma();
    const repository = new ProductRepository(db);

    await repository.findList('tenant-a', {
      page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc',
    }, 0, 10);
    await repository.categoryExists('tenant-a', 'category-b');
    await repository.brandExists('tenant-a', 'brand-b');

    expect(db.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-a' }),
    }));
    expect(db.category.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'category-b', tenantId: 'tenant-a' },
    }));
    expect(db.brand.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'brand-b', tenantId: 'tenant-a' },
    }));
  });

  it('creates one cart per tenant for the same user', async () => {
    const db = makePrisma();
    const repository = new CartRepository(db);

    await repository.getOrCreateCart('tenant-a', 'user-1');
    await repository.getOrCreateCart('tenant-b', 'user-1');

    expect(db.cart.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { tenantId_userId: { tenantId: 'tenant-a', userId: 'user-1' } },
      create: { tenantId: 'tenant-a', userId: 'user-1' },
    }));
    expect(db.cart.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { tenantId_userId: { tenantId: 'tenant-b', userId: 'user-1' } },
      create: { tenantId: 'tenant-b', userId: 'user-1' },
    }));
  });

  it('rejects cart item lookup for a variant owned by another tenant', async () => {
    const db = makePrisma();
    const repository = new CartRepository(db);

    await repository.findCartItem('tenant-a', 'user-1', 'variant-b');

    expect(db.cartItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        cart: { tenantId: 'tenant-a', userId: 'user-1' },
        variant: { product: { tenantId: 'tenant-a' } },
      }),
    }));
  });
});
