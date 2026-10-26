import { prisma } from '../../config/prisma.js';

export class ShippingRepository {
  async findProfile(scopeKey: string) {
    return prisma.shippingProfile.findFirst({
      where: {
        scopeKey,
        isActive: true,
      },
      include: {
        zones: {
          where: {
            isActive: true,
          },
          include: {
            methods: {
              where: {
                isActive: true,
              },
              include: {
                rules: {
                  orderBy: [
                    {
                      priority: 'desc',
                    },
                    {
                      minOrderAmount: 'desc',
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
  }
}