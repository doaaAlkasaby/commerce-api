import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { ProductAttributeRepository } from '../../src/modules/product-attributes/product-attribute.repository.js';
import { ProductVariantImageRepository } from '../../src/modules/product-variant-images/product-variant-image.repository.js';

describe('tenant-owned child repositories', () => {
  it('scopes attributes and values through their product tenant', async () => {
    const db = {
      productAttribute: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      productAttributeValue: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
      },
      productVariantValue: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaClient;
    const repository = new ProductAttributeRepository(db);

    await repository.findById('tenant-a', 'attribute-b');
    await repository.findValueById('tenant-a', 'value-b');
    await repository.countVariantsUsingAttributeValue('tenant-a', 'value-b');

    expect(db.productAttribute.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'attribute-b', product: { tenantId: 'tenant-a' } },
    }));
    expect(db.productAttributeValue.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'value-b', attribute: { product: { tenantId: 'tenant-a' } } },
    }));
    expect(db.productVariantValue.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        attributeValue: { attribute: { product: { tenantId: 'tenant-a' } } },
        variant: { product: { tenantId: 'tenant-a' } },
      }),
    }));
  });

  it('checks image ownership before mutating by unique ID', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'image-b' });
    const db = {
      productVariantImage: {
        findFirst: vi.fn().mockResolvedValue({ id: 'image-b' }),
        update,
      },
    } as unknown as PrismaClient;
    const repository = new ProductVariantImageRepository(db);

    await repository.update('tenant-a', 'image-b', { altText: 'changed' });

    expect(db.productVariantImage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'image-b', variant: { product: { tenantId: 'tenant-a' } } },
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'image-b' }, data: { altText: 'changed' },
    }));
  });

  it('does not update a variant image when the tenant ownership check misses', async () => {
    const update = vi.fn();
    const db = {
      productVariantImage: {
        findFirst: vi.fn().mockResolvedValue(null),
        update,
      },
    } as unknown as PrismaClient;
    const repository = new ProductVariantImageRepository(db);

    await expect(repository.update('tenant-a', 'image-b', { sortOrder: 3 })).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
