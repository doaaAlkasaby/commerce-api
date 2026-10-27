import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  bannerIdParamsSchema,
  createBannerSchema,
  updateBannerSchema,
} from './banner.schemas.js';

import { bannerService } from './banner.service.instance.js';

const getBannerId = (
  req: Request,
): string => {
  const result = bannerIdParamsSchema.safeParse(
    req.validatedParams ?? req.params,
  );

  if (!result.success) {
    throw new AppError(
      'Invalid banner ID',
      400,
      'INVALID_BANNER_ID',
    );
  }

  return result.data.id;
};

const getValidatedBody = <T>(
  req: Request,
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | { success: false };
  },
): T => {
  const result = schema.safeParse(
    req.validatedBody ?? req.body,
  );

  if (!result.success) {
    throw new AppError(
      'Invalid banner data',
      400,
      'VALIDATION_ERROR',
    );
  }

  return result.data;
};

export const listBanners = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await bannerService.listBanners(req.tenant!.tenantId);

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const listActiveBanners = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await bannerService.listActiveBanners(req.tenant!.tenantId);

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const getBanner = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await bannerService.getBanner(
        req.tenant!.tenantId,
        getBannerId(req),
      );

    res.status(200).json({
      success: true,
      message: null,
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const createBanner = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await bannerService.createBanner(
        req.tenant!.tenantId,
        getValidatedBody(
          req,
          createBannerSchema,
        ),
      );

    res.status(201).json({
      success: true,
      message: 'Banner created successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const updateBanner = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const data =
      await bannerService.updateBanner(
        req.tenant!.tenantId,
        getBannerId(req),
        getValidatedBody(
          req,
          updateBannerSchema,
        ),
      );

    res.status(200).json({
      success: true,
      message: 'Banner updated successfully',
      data,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteBanner = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    await bannerService.deleteBanner(
      req.tenant!.tenantId,
      getBannerId(req),
    );

    res.status(200).json({
      success: true,
      message: 'Banner deleted successfully',
      data: null,
    });
  } catch (error) {
    next(error);
  }
};
