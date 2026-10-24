import { prisma } from '../../config/database.js';

import { BannerRepository } from './banner.repository.js';

export const bannerRepository =
  new BannerRepository(prisma);