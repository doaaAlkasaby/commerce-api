import { bannerRepository } from './banner.repository.instance.js';

import { BannerService } from './banner.service.js';

export const bannerService =
  new BannerService(
    bannerRepository,
  );