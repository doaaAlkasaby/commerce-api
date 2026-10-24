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
        getBrandId(req),
      );

    res.status(200).json({
      success: true,
      message: null,
      data: brand,
    });
  },

  getAll: async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    const brands =
      await brandService.getAll();

    res.status(200).json({
      success: true,
      message: null,
      data: brands,
    });
  },

  getActive: async (
    _req: Request,
    res: Response,
  ): Promise<void> => {
    const brands =
      await brandService.getActive();

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
      getBrandId(req),
    );

    res.status(200).json({
      success: true,
      message: 'Brand deleted successfully',
      data: null,
    });
  },
};