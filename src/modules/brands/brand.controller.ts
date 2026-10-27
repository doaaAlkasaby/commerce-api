import type {
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  brandService,
} from './brand.service.instance.js';

const getBrandId = (
  req: Request,
): string => {
  const { id } = req.params;

  if (typeof id !== 'string') {
    throw new AppError(
      'Brand ID is required',
      400,
      'INVALID_BRAND_ID',
    );
  }

  return id;
};

export const brandController = {
  create: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const brand =
      await brandService.create(
        req.tenant!.tenantId,
        req.body,
      );

    res.status(201).json({
      success: true,
      message: 'Brand created successfully',
      data: brand,
    });
  },

  getById: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const brand =
      await brandService.getById(
        req.tenant!.tenantId,
        getBrandId(req),
      );

    res.status(200).json({
      success: true,
      message: null,
      data: brand,
    });
  },

  getAll: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const brands =
        await brandService.getAll(req.tenant!.tenantId);

    res.status(200).json({
      success: true,
      message: null,
      data: brands,
    });
  },

  getActive: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const brands =
        await brandService.getActive(req.tenant!.tenantId);

    res.status(200).json({
      success: true,
      message: null,
      data: brands,
    });
  },

  update: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const brand =
      await brandService.update(
        req.tenant!.tenantId,
        getBrandId(req),
        req.body,
      );

    res.status(200).json({
      success: true,
      message: 'Brand updated successfully',
      data: brand,
    });
  },

  updateStatus: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const brand =
      await brandService.updateStatus(
        req.tenant!.tenantId,
        getBrandId(req),
        req.body.isActive,
      );

    res.status(200).json({
      success: true,
      message:
        'Brand status updated successfully',
      data: brand,
    });
  },

  uploadImage: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const file = req.file;

    if (!file) {
      throw new AppError(
        'Image file is required',
        400,
        'IMAGE_FILE_REQUIRED',
      );
    }

    const brand =
      await brandService.uploadImage(
        req.tenant!.tenantId,
        getBrandId(req),
        {
          file: file.buffer,
          originalName: file.originalname,
          contentType: file.mimetype,
        },
      );

    res.status(200).json({
      success: true,
      message: 'Brand image uploaded successfully',
      data: brand,
    });
  },

  deleteImage: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await brandService.deleteImage(
      req.tenant!.tenantId,
      getBrandId(req),
    );

    res.status(200).json({
      success: true,
      message: 'Brand image deleted successfully',
      data: null,
    });
  },

  delete: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await brandService.delete(
      req.tenant!.tenantId,
      getBrandId(req),
    );

    res.status(200).json({
      success: true,
      message: 'Brand deleted successfully',
      data: null,
    });
  },
};
