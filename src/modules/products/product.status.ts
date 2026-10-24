import { ProductStatus } from '../../generated/prisma/client.js';

import { AppError } from '../../common/errors/app-error.js';

export const validateProductStatusTransition = (
  currentStatus: ProductStatus,
  nextStatus: ProductStatus,
): void => {
  if (currentStatus === nextStatus) {
    return;
  }

  const allowedTransitions: Record<ProductStatus, ProductStatus[]> = {
    [ProductStatus.DRAFT]: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],

    [ProductStatus.ACTIVE]: [ProductStatus.INACTIVE, ProductStatus.ARCHIVED],

    [ProductStatus.INACTIVE]: [ProductStatus.ACTIVE, ProductStatus.ARCHIVED],

    [ProductStatus.ARCHIVED]: [],
  };

  const allowed = allowedTransitions[currentStatus];

  if (!allowed.includes(nextStatus)) {
    throw new AppError(
      `Invalid product status transition from ${currentStatus} to ${nextStatus}`,
      400,
      'INVALID_PRODUCT_STATUS_TRANSITION',
    );
  }
};
