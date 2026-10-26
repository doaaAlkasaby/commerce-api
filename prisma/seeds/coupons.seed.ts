import {
  PrismaClient,
} from '../../src/generated/prisma/client.js';




// ============================================================
// Coupons
// ============================================================

export async function seedCoupons(prisma: PrismaClient,) {
  console.log('🎟️ Seeding coupons...');

  const coupons = [
    {
      code: 'WELCOME10',
      discountType: 'PERCENTAGE' as const,
      discountValue: '10.00',
      minimumOrderAmount: '50.00',
      maximumDiscountAmount: '30.00',
    },
    {
      code: 'SAVE20',
      discountType: 'PERCENTAGE' as const,
      discountValue: '20.00',
      minimumOrderAmount: '100.00',
      maximumDiscountAmount: '50.00',
    },
    {
      code: 'FLAT15',
      discountType: 'FIXED_AMOUNT' as const,
      discountValue: '15.00',
      minimumOrderAmount: '75.00',
      maximumDiscountAmount: null,
    },
    {
      code: 'VIP25',
      discountType: 'PERCENTAGE' as const,
      discountValue: '25.00',
      minimumOrderAmount: '150.00',
      maximumDiscountAmount: '75.00',
    },
    {
      code: 'NO_MINIMUM',
      discountType: 'FIXED_AMOUNT' as const,
      discountValue: '5.00',
      minimumOrderAmount: null,
      maximumDiscountAmount: null,
    },
  ];

  for (const coupon of coupons) {
    await prisma.coupon.upsert({
      where: {
        code: coupon.code,
      },
      update: {
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minimumOrderAmount: coupon.minimumOrderAmount,
        maximumDiscountAmount: coupon.maximumDiscountAmount,
        isActive: true,
      },
      create: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minimumOrderAmount: coupon.minimumOrderAmount,
        maximumDiscountAmount: coupon.maximumDiscountAmount,
        isActive: true,
      },
    });
  }

  console.log(`   ✓ ${coupons.length} coupons seeded`);
}