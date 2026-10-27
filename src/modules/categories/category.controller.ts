import type {
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  categoryService,
} from './category.service.instance.js';

const getCategoryId = (
  req: Request,
): string => {
  const { id } = req.params;

  if (typeof id !== 'string') {
    throw new AppError(
      'Category ID is required',
      400,
      'INVALID_CATEGORY_ID',
    );
  }

  return id;
};

export const categoryController = {
  create: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const category =
      await categoryService.create(
        req.tenant!.tenantId,
        req.body,
      );

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category,
    });
  },

  getById: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const category =
      await categoryService.getById(
        req.tenant!.tenantId,
        getCategoryId(req),
      );

    res.status(200).json({
      success: true,
      message: null,
      data: category,
    });
  },

  getAll: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const categories =
        await categoryService.getAll(req.tenant!.tenantId);

    res.status(200).json({
      success: true,
      message: null,
      data: categories,
    });
  },

  getActive: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const categories =
        await categoryService.getActive(req.tenant!.tenantId);

    res.status(200).json({
      success: true,
      message: null,
      data: categories,
    });
  },

  getChildren: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const categories =
      await categoryService.getChildren(
        req.tenant!.tenantId,
        getCategoryId(req),
      );

    res.status(200).json({
      success: true,
      message: null,
      data: categories,
    });
  },

  update: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const category =
      await categoryService.update(
        req.tenant!.tenantId,
        getCategoryId(req),
        req.body,
      );

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category,
    });
  },

  updateStatus: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const category =
      await categoryService.updateStatus(
        req.tenant!.tenantId,
        getCategoryId(req),
        req.body.isActive,
      );

    res.status(200).json({
      success: true,
      message:
        'Category status updated successfully',
      data: category,
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

    const category =
      await categoryService.uploadImage(
        req.tenant!.tenantId,
        getCategoryId(req),
        {
          file: file.buffer,
          originalName: file.originalname,
          contentType: file.mimetype,
        },
      );

    res.status(200).json({
      success: true,
      message: 'Category image uploaded successfully',
      data: category,
    });
  },

  deleteImage: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await categoryService.deleteImage(
      req.tenant!.tenantId,
      getCategoryId(req),
    );

    res.status(200).json({
      success: true,
      message: 'Category image deleted successfully',
      data: null,
    });
  },

  delete: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await categoryService.delete(
      req.tenant!.tenantId,
      getCategoryId(req),
    );

    res.status(200).json({
      success: true,
      message:
        'Category deleted successfully',
      data: null,
    });
  },
};
