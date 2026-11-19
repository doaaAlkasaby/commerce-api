import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { createHash } from 'node:crypto';

function developmentId(name: string) {
  const hex = createHash('sha256')
    .update(`commerce-development-v81:${name}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Product A: 8 Sparse Variants Definition Matrix
export const linenShirtVariantsDef = [
  { color: 'White', size: 'S', fit: 'Slim', sku: 'LUMA-SHIRT-WHI-S-SLM', price: '18.000', stock: 8, imgSuffix: 'white' },
  { color: 'White', size: 'M', fit: 'Slim', sku: 'LUMA-SHIRT-WHI-M-SLM', price: '19.000', stock: 6, imgSuffix: 'white' },
  { color: 'White', size: 'L', fit: 'Regular', sku: 'LUMA-SHIRT-WHI-L-REG', price: '21.000', stock: 5, imgSuffix: 'white' },
  { color: 'Beige', size: 'M', fit: 'Regular', sku: 'LUMA-SHIRT-BEI-M-REG', price: '20.000', stock: 7, imgSuffix: 'beige' },
  { color: 'Beige', size: 'L', fit: 'Regular', sku: 'LUMA-SHIRT-BEI-L-REG', price: '22.000', stock: 4, imgSuffix: 'beige' },
  { color: 'Navy', size: 'M', fit: 'Slim', sku: 'LUMA-SHIRT-NAV-M-SLM', price: '23.000', stock: 3, imgSuffix: 'navy' },
  { color: 'Navy', size: 'XL', fit: 'Regular', sku: 'LUMA-SHIRT-NAV-XL-REG', price: '26.000', stock: 2, imgSuffix: 'navy' },
  { color: 'Navy', size: 'L', fit: 'Slim', sku: 'LUMA-SHIRT-NAV-L-SLM', price: '24.000', stock: 0, imgSuffix: 'navy' }, // OUT OF STOCK
];

export async function seedTask11Products(prisma: PrismaClient | Prisma.TransactionClient) {
  console.log('🛍️ Seeding Task 11 Test Products (Luma Premium Linen Shirt & Luma Leather Travel Organizer)...');

  const luma = await prisma.tenant.findUnique({
    where: { slug: 'dev81-kuwait-fashion' },
  });

  if (!luma) throw new Error('Tenant dev81-kuwait-fashion not found');

  const clothingCategory =
    (await prisma.category.findFirst({
      where: { tenantId: luma.id, slug: 'development-clothing' },
    })) ??
    (await prisma.category.findFirst({
      where: { tenantId: luma.id, slug: 'dresses' },
    }));

  const handbagsCategory = await prisma.category.findFirst({
    where: { tenantId: luma.id, slug: 'handbags' },
  });

  const defaultWarehouse =
    (await prisma.warehouse.findFirst({
      where: { tenantId: luma.id },
    })) ??
    (await prisma.warehouse.upsert({
      where: { id: developmentId(`warehouse:${luma.slug}`) },
      update: {},
      create: {
        id: developmentId(`warehouse:${luma.slug}`),
        tenantId: luma.id,
        name: 'Primary Warehouse',
        code: 'WH-DEV81-LUMA',
        isActive: true,
      },
    }));

  if (!clothingCategory || !handbagsCategory || !defaultWarehouse) {
    throw new Error('Required category or warehouse not found in Luma');
  }

  // Resolve Luma's exact DEV81_STANDARD (or STANDARD in test DBs) tax category; fail explicitly if missing or inactive.
  const taxCategory =
    (await prisma.taxCategory.findUnique({
      where: { tenantId_code: { tenantId: luma.id, code: 'DEV81_STANDARD' } },
    })) ??
    (await prisma.taxCategory.findUnique({
      where: { tenantId_code: { tenantId: luma.id, code: 'STANDARD' } },
    }));

  if (!taxCategory || !taxCategory.isActive) {
    throw new Error('Required active tax category (DEV81_STANDARD / STANDARD) not found for Luma tenant.');
  }

  // ==========================================
  // PRODUCT A: Luma Premium Linen Shirt
  // ==========================================
  const shirtId = developmentId('prod:luma:premium-linen-shirt');
  const shirtProduct = await prisma.product.upsert({
    where: { id: shirtId },
    update: {
      name: 'Luma Premium Linen Shirt',
      description: 'Handcrafted breathable linen shirt available in slim and regular fits across white, beige, and navy tones.',
      basePrice: '19.000',
      categoryId: clothingCategory.id,
      status: 'ACTIVE',
      taxCategoryId: taxCategory.id,
    },
    create: {
      id: shirtId,
      tenantId: luma.id,
      categoryId: clothingCategory.id,
      name: 'Luma Premium Linen Shirt',
      slug: 'luma-premium-linen-shirt',
      description: 'Handcrafted breathable linen shirt available in slim and regular fits across white, beige, and navy tones.',
      basePrice: '19.000',
      status: 'ACTIVE',
      taxCategoryId: taxCategory.id,
    },
  });

  // Shirt Attributes: Color, Size, Fit
  const attrColor = await prisma.productAttribute.upsert({
    where: { productId_name: { productId: shirtProduct.id, name: 'Color' } },
    update: {},
    create: { id: developmentId('attr:shirt:color'), productId: shirtProduct.id, name: 'Color', sortOrder: 0 },
  });

  const attrSize = await prisma.productAttribute.upsert({
    where: { productId_name: { productId: shirtProduct.id, name: 'Size' } },
    update: {},
    create: { id: developmentId('attr:shirt:size'), productId: shirtProduct.id, name: 'Size', sortOrder: 1 },
  });

  const attrFit = await prisma.productAttribute.upsert({
    where: { productId_name: { productId: shirtProduct.id, name: 'Fit' } },
    update: {},
    create: { id: developmentId('attr:shirt:fit'), productId: shirtProduct.id, name: 'Fit', sortOrder: 2 },
  });

  // Shirt Attribute Values
  const valWhite = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:color:white') },
    update: { value: 'White' },
    create: { id: developmentId('attrval:shirt:color:white'), attributeId: attrColor.id, value: 'White', sortOrder: 0 },
  });

  const valBeige = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:color:beige') },
    update: { value: 'Beige' },
    create: { id: developmentId('attrval:shirt:color:beige'), attributeId: attrColor.id, value: 'Beige', sortOrder: 1 },
  });

  const valNavy = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:color:navy') },
    update: { value: 'Navy' },
    create: { id: developmentId('attrval:shirt:color:navy'), attributeId: attrColor.id, value: 'Navy', sortOrder: 2 },
  });

  const valS = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:size:s') },
    update: { value: 'S' },
    create: { id: developmentId('attrval:shirt:size:s'), attributeId: attrSize.id, value: 'S', sortOrder: 0 },
  });

  const valM = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:size:m') },
    update: { value: 'M' },
    create: { id: developmentId('attrval:shirt:size:m'), attributeId: attrSize.id, value: 'M', sortOrder: 1 },
  });

  const valL = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:size:l') },
    update: { value: 'L' },
    create: { id: developmentId('attrval:shirt:size:l'), attributeId: attrSize.id, value: 'L', sortOrder: 2 },
  });

  const valXL = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:size:xl') },
    update: { value: 'XL' },
    create: { id: developmentId('attrval:shirt:size:xl'), attributeId: attrSize.id, value: 'XL', sortOrder: 3 },
  });

  const valSlim = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:fit:slim') },
    update: { value: 'Slim' },
    create: { id: developmentId('attrval:shirt:fit:slim'), attributeId: attrFit.id, value: 'Slim', sortOrder: 0 },
  });

  const valRegular = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:shirt:fit:regular') },
    update: { value: 'Regular' },
    create: { id: developmentId('attrval:shirt:fit:regular'), attributeId: attrFit.id, value: 'Regular', sortOrder: 1 },
  });

  const valMap: Record<string, string> = {
    'White': valWhite.id,
    'Beige': valBeige.id,
    'Navy': valNavy.id,
    'S': valS.id,
    'M': valM.id,
    'L': valL.id,
    'XL': valXL.id,
    'Slim': valSlim.id,
    'Regular': valRegular.id,
  };

  // Product Gallery Image
  await prisma.productImage.upsert({
    where: { id: developmentId('img:shirt:main') },
    update: { url: '/uploads/products/luma-linen-shirt-main.webp', isPrimary: true },
    create: {
      id: developmentId('img:shirt:main'),
      productId: shirtProduct.id,
      storageKey: 'products/luma-linen-shirt-main.webp',
      url: '/uploads/products/luma-linen-shirt-main.webp',
      isPrimary: true,
      sortOrder: 0,
    },
  });

  // Seed 8 Sparse Variants with 20% Percentage Discount
  const startDate = new Date('2026-01-01');
  const endDate = new Date('2030-12-31');

  for (let idx = 0; idx < linenShirtVariantsDef.length; idx++) {
    const vDef = linenShirtVariantsDef[idx];
    const varId = developmentId(`variant:${vDef.sku}`);
    const colorValId = valMap[vDef.color];
    const sizeValId = valMap[vDef.size];
    const fitValId = valMap[vDef.fit];
    const comboKey = [colorValId, sizeValId, fitValId].sort().join(':');
    const isDefault = idx === 1; // White/M/Slim as default

    const variant = await prisma.productVariant.upsert({
      where: { id: varId },
      update: {
        price: vDef.price,
        sku: vDef.sku,
        combinationKey: comboKey,
        isDefault,
        isActive: true,
        discountType: 'PERCENTAGE',
        discountValue: '20',
        discountStartsAt: startDate,
        discountEndsAt: endDate,
      },
      create: {
        id: varId,
        productId: shirtProduct.id,
        sku: vDef.sku,
        price: vDef.price,
        combinationKey: comboKey,
        isDefault,
        isActive: true,
        discountType: 'PERCENTAGE',
        discountValue: '20',
        discountStartsAt: startDate,
        discountEndsAt: endDate,
      },
    });

    // Variant Values
    for (const valId of [colorValId, sizeValId, fitValId]) {
      await prisma.productVariantValue.upsert({
        where: { variantId_attributeValueId: { variantId: variant.id, attributeValueId: valId } },
        update: {},
        create: { variantId: variant.id, attributeValueId: valId },
      });
    }

    // Variant Inventory - update: {} preserves existing stock on subsequent seed runs!
    await prisma.inventory.upsert({
      where: { warehouseId_variantId: { warehouseId: defaultWarehouse.id, variantId: variant.id } },
      update: {},
      create: {
        id: developmentId(`inv:${vDef.sku}`),
        tenantId: luma.id,
        variantId: variant.id,
        warehouseId: defaultWarehouse.id,
        quantity: vDef.stock,
      },
    });

    // Variant Images
    const varImg1Id = developmentId(`varimg:primary:${vDef.sku}`);
    const varImg2Id = developmentId(`varimg:detail:${vDef.sku}`);
    const url1 = `/uploads/products/luma-linen-shirt-${vDef.imgSuffix}-1.webp`;
    const url2 = `/uploads/products/luma-linen-shirt-${vDef.imgSuffix}-2.webp`;

    await prisma.productVariantImage.upsert({
      where: { id: varImg1Id },
      update: { url: url1, isPrimary: true, sortOrder: 0 },
      create: {
        id: varImg1Id,
        variantId: variant.id,
        storageKey: `products/luma-linen-shirt-${vDef.imgSuffix}-1.webp`,
        url: url1,
        isPrimary: true,
        sortOrder: 0,
      },
    });

    await prisma.productVariantImage.upsert({
      where: { id: varImg2Id },
      update: { url: url2, isPrimary: false, sortOrder: 1 },
      create: {
        id: varImg2Id,
        variantId: variant.id,
        storageKey: `products/luma-linen-shirt-${vDef.imgSuffix}-2.webp`,
        url: url2,
        isPrimary: false,
        sortOrder: 1,
      },
    });
  }

  // ==========================================
  // PRODUCT B: Luma Leather Travel Organizer
  // ==========================================
  const organizerId = developmentId('prod:luma:leather-travel-organizer');
  const organizerProduct = await prisma.product.upsert({
    where: { id: organizerId },
    update: {
      name: 'Luma Leather Travel Organizer',
      description: 'Compact genuine leather travel organizer with passport slots, card holders, and zippered coin pocket.',
      basePrice: '30.000',
      categoryId: handbagsCategory.id,
      status: 'ACTIVE',
      taxCategoryId: taxCategory.id,
    },
    create: {
      id: organizerId,
      tenantId: luma.id,
      categoryId: handbagsCategory.id,
      name: 'Luma Leather Travel Organizer',
      slug: 'luma-leather-travel-organizer',
      description: 'Compact genuine leather travel organizer with passport slots, card holders, and zippered coin pocket.',
      basePrice: '30.000',
      status: 'ACTIVE',
      taxCategoryId: taxCategory.id,
    },
  });

  // Product B Image
  await prisma.productImage.upsert({
    where: { id: developmentId('img:organizer:main') },
    update: { url: '/uploads/products/luma-organizer-main.webp', isPrimary: true },
    create: {
      id: developmentId('img:organizer:main'),
      productId: organizerProduct.id,
      storageKey: 'products/luma-organizer-main.webp',
      url: '/uploads/products/luma-organizer-main.webp',
      isPrimary: true,
      sortOrder: 0,
    },
  });

  // Product B Default Variant
  const organizerVarId = developmentId('variant:LUMA-ORGANIZER-STD');
  const organizerVariant = await prisma.productVariant.upsert({
    where: { id: organizerVarId },
    update: {
      price: '30.000',
      sku: 'LUMA-ORGANIZER-STD',
      combinationKey: 'default',
      isDefault: true,
      isActive: true,
    },
    create: {
      id: organizerVarId,
      productId: organizerProduct.id,
      sku: 'LUMA-ORGANIZER-STD',
      price: '30.000',
      combinationKey: 'default',
      isDefault: true,
      isActive: true,
    },
  });

  // Product B Inventory - update: {} preserves existing stock on subsequent seed runs!
  await prisma.inventory.upsert({
    where: { warehouseId_variantId: { warehouseId: defaultWarehouse.id, variantId: organizerVariant.id } },
    update: {},
    create: {
      id: developmentId('inv:LUMA-ORGANIZER-STD'),
      tenantId: luma.id,
      variantId: organizerVariant.id,
      warehouseId: defaultWarehouse.id,
      quantity: 10,
    },
  });

  console.log('   ✓ Task 11 Test Products seeded successfully.');
}
