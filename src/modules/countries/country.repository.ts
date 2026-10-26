import { prisma } from '../../config/prisma.js';

export class CountryRepository {
  async findActiveCountries() {
    return prisma.country.findMany({
      where: {
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        code: true,
        name: true,
        currencyCode: true,
      },
    });
  }
}