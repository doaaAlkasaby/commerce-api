import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';

export const legacyProductImageUpdates = [
  // Luma - Cotton T-shirt
  { productId: '96d71bff-1fae-4e25-ac00-1c72014b9968', primaryImageId: '8ed3f6e6-2ad0-4d02-a5b0-9cd274c42511', newPrimaryUrl: '/uploads/legacy-products/luma-tee-front.webp', secondaryImageId: '56cfa5f6-bdfe-4374-af0b-c2c5037dc7e8', newSecondaryUrl: '/uploads/legacy-products/luma-tee-detail.webp' },
  // Luma - Straight denim
  { productId: 'a59498b5-fece-4dab-a626-9b9a343a1086', primaryImageId: 'f803387d-42c9-48af-a9e6-c46c0d903dc7', newPrimaryUrl: '/uploads/legacy-products/luma-denim-front.webp', secondaryImageId: '9b3b999e-d190-48fe-a72d-d306ea804e1b', newSecondaryUrl: '/uploads/legacy-products/luma-denim-detail.webp' },
  // Luma - Everyday sneakers
  { productId: '2fd2af88-8635-4b8d-a763-52292c5c2d7f', primaryImageId: 'f6d52515-87ff-4f9a-a364-dc3d60ac3650', newPrimaryUrl: '/uploads/legacy-products/luma-shoes-front.webp', secondaryImageId: '64651a9c-c65c-4c99-aeee-6494fbf54938', newSecondaryUrl: '/uploads/legacy-products/luma-shoes-detail.webp' },

  // Noura - Cotton T-shirt
  { productId: 'dc6d8189-8581-43c0-a425-00d08232ce20', primaryImageId: '8ecf046e-a8cd-49a1-a0bd-a6455a650bff', newPrimaryUrl: '/uploads/legacy-products/noura-tee-front.webp', secondaryImageId: '4c62ac09-6275-4ff4-ab05-b37f97552584', newSecondaryUrl: '/uploads/legacy-products/noura-tee-detail.webp' },
  // Noura - Straight denim
  { productId: 'f0ec8311-76ae-4c2a-ad71-84db61b389dc', primaryImageId: '3bf23ff5-43e2-4a17-aa6d-296c32a09500', newPrimaryUrl: '/uploads/legacy-products/noura-denim-front.webp', secondaryImageId: 'a950b276-e83b-469d-a397-bb826d641392', newSecondaryUrl: '/uploads/legacy-products/noura-denim-detail.webp' },
  // Noura - Everyday sneakers
  { productId: '07a02619-4683-4757-a1e6-928eb223da98', primaryImageId: '3fcb5652-64fe-42f9-a6f2-f0669fd0ae24', newPrimaryUrl: '/uploads/legacy-products/noura-shoes-front.webp', secondaryImageId: '1976ac75-fe25-4c7a-a5a6-792ddc0d9a82', newSecondaryUrl: '/uploads/legacy-products/noura-shoes-detail.webp' },
];

export async function updateLegacyProductImages(prisma: PrismaClient | Prisma.TransactionClient) {
  console.log('🖼️ Updating 12 legacy product image records with real studio WebP photography...');

  for (const updateDef of legacyProductImageUpdates) {
    // Update Primary Image
    await prisma.productImage.update({
      where: { id: updateDef.primaryImageId },
      data: { url: updateDef.newPrimaryUrl },
    });

    // Update Secondary Image
    await prisma.productImage.update({
      where: { id: updateDef.secondaryImageId },
      data: { url: updateDef.newSecondaryUrl },
    });
  }

  console.log('   ✓ 12 ProductImage records updated successfully.');
}
