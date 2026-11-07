import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { prisma } from '../../config/database.js';

export class ShippingRepository {
  constructor(
    private readonly client: Prisma.TransactionClient | PrismaClient = prisma,
  ) {}
  async findProfile(tenantId: string, countryCode: string) {
    return this.client.shippingProfile.findFirst({
      where: {
        tenantId,
        countryCode,
        isActive: true,
        country: { isActive: true },
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
                  where: { isActive: true },
                  orderBy: [
                    {
                      priority: 'desc',
                    },
                    {
                      minOrderAmount: {
                        sort: 'desc',
                        nulls: 'last',
                      },
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
