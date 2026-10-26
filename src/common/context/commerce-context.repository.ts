import { prisma } from '../../config/prisma.js';

export class CommerceContextRepository {
  async findCountryByCode(code: string) {
    return prisma.country.findFirst({
      where: {
        code,
        isActive: true,
      },
      select: {
        code: true,
        name: true,
        currencyCode: true,
      },
    });
  }

  async findUserDefaultCountry(userId: string) {
    return prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        defaultCountry: {
          select: {
            code: true,
            name: true,
            currencyCode: true,
          },
        },
      },
    });
  }
}