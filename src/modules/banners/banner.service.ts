import { AppError } from '../../common/errors/app-error.js';

import type {
  BannerTargetType,
} from '../../generated/prisma/client.js';

import type { BannerRepository } from './banner.repository.js';

import type {
  CreateBannerInput,
  UpdateBannerInput,
} from './banner.types.js';

import { mapBanner } from './banner.mapper.js';

export class BannerService {
  constructor(
    private readonly repository: BannerRepository,
  ) {}

  async listBanners(tenantId: string) {
    const banners =
      await this.repository.findMany(tenantId);

    return banners.map(mapBanner);
  }

  async listActiveBanners(tenantId: string) {
    const banners =
      await this.repository.findActive(tenantId);

    return banners.map(mapBanner);
  }

  async getBanner(tenantId: string, id: string) {
    const banner =
      await this.repository.findById(tenantId, id);

    if (!banner) {
      throw new AppError(
        'Banner not found',
        404,
        'BANNER_NOT_FOUND',
      );
    }

    return mapBanner(banner);
  }

  async createBanner(
    tenantId: string,
    input: CreateBannerInput,
  ) {
    this.validateDateRange(
      input.startsAt,
      input.endsAt,
    );

    await this.validateTarget(
      tenantId,
      input.targetType ?? 'NONE',
      input.targetId ?? null,
      input.actionUrl ?? null,
    );

    const banner =
      await this.repository.create(tenantId, input);

    return mapBanner(banner);
  }

  async updateBanner(
    tenantId: string,
    id: string,
    input: UpdateBannerInput,
  ) {
    const existing =
      await this.repository.findById(tenantId, id);

    if (!existing) {
      throw new AppError(
        'Banner not found',
        404,
        'BANNER_NOT_FOUND',
      );
    }

    const targetType =
      input.targetType ??
      existing.targetType;

    const targetId =
      input.targetId !== undefined
        ? input.targetId
        : existing.targetId;

    const actionUrl =
      input.actionUrl !== undefined
        ? input.actionUrl
        : existing.actionUrl;

    const startsAt =
      input.startsAt !== undefined
        ? input.startsAt
        : existing.startsAt;

    const endsAt =
      input.endsAt !== undefined
        ? input.endsAt
        : existing.endsAt;

    this.validateDateRange(
      startsAt,
      endsAt,
    );

    await this.validateTarget(
      tenantId,
      targetType,
      targetId,
      actionUrl,
    );

    const banner =
      await this.repository.update(
        tenantId,
        id,
        input,
      );

    return mapBanner(banner);
  }

  async deleteBanner(tenantId: string, id: string) {
    const existing =
      await this.repository.findById(tenantId, id);

    if (!existing) {
      throw new AppError(
        'Banner not found',
        404,
        'BANNER_NOT_FOUND',
      );
    }

    await this.repository.delete(tenantId, id);

    return null;
  }

  private validateDateRange(
    startsAt?: Date | null,
    endsAt?: Date | null,
  ): void {
    if (
      startsAt &&
      endsAt &&
      endsAt <= startsAt
    ) {
      throw new AppError(
        'endsAt must be after startsAt',
        400,
        'INVALID_BANNER_DATE_RANGE',
      );
    }
  }

  private async validateTarget(
    tenantId: string,
    targetType: BannerTargetType,
    targetId: string | null,
    actionUrl: string | null,
  ): Promise<void> {
    switch (targetType) {
      case 'NONE':
        if (targetId || actionUrl) {
          throw new AppError(
            'NONE target cannot have targetId or actionUrl',
            400,
            'INVALID_BANNER_TARGET',
          );
        }

        return;

      case 'PRODUCT':
        if (!targetId || actionUrl) {
          throw new AppError(
            'PRODUCT target requires targetId and cannot have actionUrl',
            400,
            'INVALID_BANNER_TARGET',
          );
        }

        if (
          !(await this.repository.productExists(
            tenantId,
            targetId,
          ))
        ) {
          throw new AppError(
            'Target product not found',
            404,
            'TARGET_PRODUCT_NOT_FOUND',
          );
        }

        return;

      case 'CATEGORY':
        if (!targetId || actionUrl) {
          throw new AppError(
            'CATEGORY target requires targetId and cannot have actionUrl',
            400,
            'INVALID_BANNER_TARGET',
          );
        }

        if (
          !(await this.repository.categoryExists(
            tenantId,
            targetId,
          ))
        ) {
          throw new AppError(
            'Target category not found',
            404,
            'TARGET_CATEGORY_NOT_FOUND',
          );
        }

        return;

      case 'COLLECTION':
        if (!targetId || actionUrl) {
          throw new AppError(
            'COLLECTION target requires targetId and cannot have actionUrl',
            400,
            'INVALID_BANNER_TARGET',
          );
        }

        if (
          !(await this.repository.collectionExists(
            tenantId,
            targetId,
          ))
        ) {
          throw new AppError(
            'Target collection not found',
            404,
            'TARGET_COLLECTION_NOT_FOUND',
          );
        }

        return;

      case 'EXTERNAL_URL':
        if (targetId || !actionUrl) {
          throw new AppError(
            'EXTERNAL_URL target requires actionUrl and cannot have targetId',
            400,
            'INVALID_BANNER_TARGET',
          );
        }

        return;
    }
  }
}
