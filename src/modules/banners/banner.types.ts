import type { BannerTargetType } from '../../generated/prisma/client.js';

export interface CreateBannerInput {
  title?: string | null | undefined;
  subtitle?: string | null | undefined;

  imageStorageKey: string;
  imageUrl: string;

  mobileImageStorageKey?: string | null | undefined;
  mobileImageUrl?: string | null | undefined;

  targetType?: BannerTargetType | undefined;
  targetId?: string | null | undefined;
  actionUrl?: string | null | undefined;

  sortOrder?: number | undefined;

  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;

  isActive?: boolean | undefined;
}

export interface UpdateBannerInput {
  title?: string | null | undefined;
  subtitle?: string | null | undefined;

  imageStorageKey?: string | undefined;
  imageUrl?: string | undefined;

  mobileImageStorageKey?: string | null | undefined;
  mobileImageUrl?: string | null | undefined;

  targetType?: BannerTargetType | undefined;
  targetId?: string | null | undefined;
  actionUrl?: string | null | undefined;

  sortOrder?: number | undefined;

  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;

  isActive?: boolean | undefined;
}