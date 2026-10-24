import type { Banner } from '../../generated/prisma/client.js';

export const mapBanner = (
  banner: Banner,
) => {
  return {
    id: banner.id,

    title: banner.title,
    subtitle: banner.subtitle,

    image: {
      url: banner.imageUrl,
    },

    mobileImage: banner.mobileImageUrl
      ? {
          url: banner.mobileImageUrl,
        }
      : null,

    target: {
      type: banner.targetType,
      id: banner.targetId,
      url: banner.actionUrl,
    },

    sortOrder: banner.sortOrder,

    startsAt: banner.startsAt,
    endsAt: banner.endsAt,

    isActive: banner.isActive,

    createdAt: banner.createdAt,
    updatedAt: banner.updatedAt,
  };
};