import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { createHash } from 'node:crypto';

function developmentId(name: string) {
  const hex = createHash('sha256')
    .update(`commerce-development-v81:${name}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const crossbodyVariantsDef = [
  { color: 'Beige', size: 'Mini', material: 'Vegan Leather', sku: 'LUMA-BAG-BEI-MIN-VEG', price: '24.000', stock: 10, imgSuffix: 'beige' },
  { color: 'Beige', size: 'Mini', material: 'Genuine Leather', sku: 'LUMA-BAG-BEI-MIN-LEA', price: '31.000', stock: 10, imgSuffix: 'beige' },
  { color: 'Beige', size: 'Medium', material: 'Vegan Leather', sku: 'LUMA-BAG-BEI-MED-VEG', price: '29.000', stock: 10, imgSuffix: 'beige' },
  { color: 'Beige', size: 'Medium', material: 'Genuine Leather', sku: 'LUMA-BAG-BEI-MED-LEA', price: '39.000', stock: 10, imgSuffix: 'beige' },

  { color: 'Black', size: 'Mini', material: 'Vegan Leather', sku: 'LUMA-BAG-BLK-MIN-VEG', price: '25.000', stock: 10, imgSuffix: 'black' },
  { color: 'Black', size: 'Mini', material: 'Genuine Leather', sku: 'LUMA-BAG-BLK-MIN-LEA', price: '32.000', stock: 10, imgSuffix: 'black' },
  { color: 'Black', size: 'Medium', material: 'Vegan Leather', sku: 'LUMA-BAG-BLK-MED-VEG', price: '30.000', stock: 10, imgSuffix: 'black' },
  { color: 'Black', size: 'Medium', material: 'Genuine Leather', sku: 'LUMA-BAG-BLK-MED-LEA', price: '40.000', stock: 10, imgSuffix: 'black' },

  { color: 'Burgundy', size: 'Mini', material: 'Vegan Leather', sku: 'LUMA-BAG-BUR-MIN-VEG', price: '26.000', stock: 10, imgSuffix: 'burgundy' },
  { color: 'Burgundy', size: 'Mini', material: 'Genuine Leather', sku: 'LUMA-BAG-BUR-MIN-LEA', price: '33.000', stock: 10, imgSuffix: 'burgundy' },
  { color: 'Burgundy', size: 'Medium', material: 'Vegan Leather', sku: 'LUMA-BAG-BUR-MED-VEG', price: '31.000', stock: 10, imgSuffix: 'burgundy' },
  { color: 'Burgundy', size: 'Medium', material: 'Genuine Leather', sku: 'LUMA-BAG-BUR-MED-LEA', price: '42.000', stock: 10, imgSuffix: 'burgundy' },
];

export async function seedCrossbodyBag(prisma: PrismaClient | Prisma.TransactionClient) {
  console.log('🛍️ Seeding Luma Signature Crossbody Bag with 12 variants in Luma store...');

  const luma = await prisma.tenant.findUnique({
    where: { slug: 'dev81-kuwait-fashion' },
  });

  if (!luma) throw new Error('Tenant dev81-kuwait-fashion not found');

  const category = await prisma.category.findFirst({
    where: { tenantId: luma.id, slug: 'handbags' },
  });

  if (!category) throw new Error('Handbags category not found in Luma');

  const defaultWarehouse = await prisma.warehouse.findFirst({
    where: { tenantId: luma.id },
  });

  if (!defaultWarehouse) throw new Error('Warehouse not found in Luma');

  const productId = developmentId('prod:luma:signature-crossbody-bag');

  // Create Product
  const product = await prisma.product.upsert({
    where: { id: productId },
    update: {
      name: 'Luma Signature Crossbody Bag',
      description: 'Premium structured crossbody handbag available in multiple colors, sizes, and materials.',
      basePrice: '24.000',
      categoryId: category.id,
      status: 'ACTIVE',
    },
    create: {
      id: productId,
      tenantId: luma.id,
      categoryId: category.id,
      name: 'Luma Signature Crossbody Bag',
      slug: 'luma-signature-crossbody-bag',
      description: 'Premium structured crossbody handbag available in multiple colors, sizes, and materials.',
      basePrice: '24.000',
      status: 'ACTIVE',
    },
  });

  // Create Product Attributes tied to Product
  const attrColor = await prisma.productAttribute.upsert({
    where: { productId_name: { productId: product.id, name: 'Color' } },
    update: {},
    create: {
      id: developmentId('attr:luma:color'),
      productId: product.id,
      name: 'Color',
      sortOrder: 0,
    },
  });

  const attrSize = await prisma.productAttribute.upsert({
    where: { productId_name: { productId: product.id, name: 'Size' } },
    update: {},
    create: {
      id: developmentId('attr:luma:size'),
      productId: product.id,
      name: 'Size',
      sortOrder: 1,
    },
  });

  const attrMaterial = await prisma.productAttribute.upsert({
    where: { productId_name: { productId: product.id, name: 'Material' } },
    update: {},
    create: {
      id: developmentId('attr:luma:material'),
      productId: product.id,
      name: 'Material',
      sortOrder: 2,
    },
  });

  // Create Attribute Values
  const valBeige = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:luma:color:beige') },
    update: { value: 'Beige' },
    create: { id: developmentId('attrval:luma:color:beige'), attributeId: attrColor.id, value: 'Beige', sortOrder: 0 },
  });

  const valBlack = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:luma:color:black') },
    update: { value: 'Black' },
    create: { id: developmentId('attrval:luma:color:black'), attributeId: attrColor.id, value: 'Black', sortOrder: 1 },
  });

  const valBurgundy = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:luma:color:burgundy') },
    update: { value: 'Burgundy' },
    create: { id: developmentId('attrval:luma:color:burgundy'), attributeId: attrColor.id, value: 'Burgundy', sortOrder: 2 },
  });

  const valMini = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:luma:size:mini') },
    update: { value: 'Mini' },
    create: { id: developmentId('attrval:luma:size:mini'), attributeId: attrSize.id, value: 'Mini', sortOrder: 0 },
  });

  const valMedium = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:luma:size:medium') },
    update: { value: 'Medium' },
    create: { id: developmentId('attrval:luma:size:medium'), attributeId: attrSize.id, value: 'Medium', sortOrder: 1 },
  });

  const valGenuine = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:luma:material:genuine') },
    update: { value: 'Genuine Leather' },
    create: { id: developmentId('attrval:luma:material:genuine'), attributeId: attrMaterial.id, value: 'Genuine Leather', sortOrder: 0 },
  });

  const valVegan = await prisma.productAttributeValue.upsert({
    where: { id: developmentId('attrval:luma:material:vegan') },
    update: { value: 'Vegan Leather' },
    create: { id: developmentId('attrval:luma:material:vegan'), attributeId: attrMaterial.id, value: 'Vegan Leather', sortOrder: 1 },
  });

  const valMap: Record<string, string> = {
    'Beige': valBeige.id,
    'Black': valBlack.id,
    'Burgundy': valBurgundy.id,
    'Mini': valMini.id,
    'Medium': valMedium.id,
    'Genuine Leather': valGenuine.id,
    'Vegan Leather': valVegan.id,
  };

  // Product Gallery Images (5)
  const galleryFiles = [
    { suffix: 'main', isPrimary: true, sortOrder: 0 },
    { suffix: 'angle2', isPrimary: false, sortOrder: 1 },
    { suffix: 'angle3', isPrimary: false, sortOrder: 2 },
    { suffix: 'angle4', isPrimary: false, sortOrder: 3 },
    { suffix: 'angle5', isPrimary: false, sortOrder: 4 },
  ];

  for (const gf of galleryFiles) {
    const imgId = developmentId(`img:luma:crossbody-bag:${gf.suffix}`);
    const url = `/uploads/products/luma-crossbody-bag-${gf.suffix}.webp`;
    await prisma.productImage.upsert({
      where: { id: imgId },
      update: { url, isPrimary: gf.isPrimary, sortOrder: gf.sortOrder },
      create: {
        id: imgId,
        productId: product.id,
        storageKey: `products/luma-crossbody-bag-${gf.suffix}.webp`,
        url,
        isPrimary: gf.isPrimary,
        sortOrder: gf.sortOrder,
      },
    });
  }

  // Create 12 Product Variants
  for (let idx = 0; idx < crossbodyVariantsDef.length; idx++) {
    const vDef = crossbodyVariantsDef[idx];
    const varId = developmentId(`variant:${vDef.sku}`);
    const colorValId = valMap[vDef.color];
    const sizeValId = valMap[vDef.size];
    const matValId = valMap[vDef.material];
    const comboKey = [colorValId, sizeValId, matValId].sort().join(':');
    const isDefault = idx === 0;

    const variant = await prisma.productVariant.upsert({
      where: { id: varId },
      update: {
        price: vDef.price,
        sku: vDef.sku,
        combinationKey: comboKey,
        isDefault,
        isActive: true,
      },
      create: {
        id: varId,
        productId: product.id,
        sku: vDef.sku,
        price: vDef.price,
        combinationKey: comboKey,
        isDefault,
        isActive: true,
      },
    });

    // Variant Attribute Values
    for (const valId of [colorValId, sizeValId, matValId]) {
      await prisma.productVariantValue.upsert({
        where: { variantId_attributeValueId: { variantId: variant.id, attributeValueId: valId } },
        update: {},
        create: { variantId: variant.id, attributeValueId: valId },
      });
    }

    // Variant Inventory
    await prisma.inventory.upsert({
      where: { warehouseId_variantId: { warehouseId: defaultWarehouse.id, variantId: variant.id } },
      update: { quantity: vDef.stock },
      create: {
        id: developmentId(`inv:${vDef.sku}`),
        tenantId: luma.id,
        variantId: variant.id,
        warehouseId: defaultWarehouse.id,
        quantity: vDef.stock,
      },
    });

    // Variant Images (2 per variant)
    const varImgPrimaryId = developmentId(`varimg:primary:${vDef.sku}`);
    const varImgDetailId = developmentId(`varimg:detail:${vDef.sku}`);
    const primaryUrl = `/uploads/products/luma-crossbody-bag-${vDef.imgSuffix}-1.webp`;
    const detailUrl = `/uploads/products/luma-crossbody-bag-${vDef.imgSuffix}-2.webp`;

    await prisma.productVariantImage.upsert({
      where: { id: varImgPrimaryId },
      update: { url: primaryUrl, isPrimary: true, sortOrder: 0 },
      create: {
        id: varImgPrimaryId,
        variantId: variant.id,
        storageKey: `products/luma-crossbody-bag-${vDef.imgSuffix}-1.webp`,
        url: primaryUrl,
        isPrimary: true,
        sortOrder: 0,
      },
    });

    await prisma.productVariantImage.upsert({
      where: { id: varImgDetailId },
      update: { url: detailUrl, isPrimary: false, sortOrder: 1 },
      create: {
        id: varImgDetailId,
        variantId: variant.id,
        storageKey: `products/luma-crossbody-bag-${vDef.imgSuffix}-2.webp`,
        url: detailUrl,
        isPrimary: false,
        sortOrder: 1,
      },
    });
  }

  console.log('   ✓ Luma Signature Crossbody Bag seeded successfully with 12 variants and 29 WebP photos.');
}
