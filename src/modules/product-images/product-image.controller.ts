import type {
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  productImageService,
} from './product-image.service.instance.js';

import {
  createProductImageSchema,
  productImageIdSchema,
  productImageProductIdSchema,
  updateProductImageSchema,
  uploadProductImageSchema,
} from './product-image.schemas.js';

const getImageId = (
  req: Request,
): string => {
  const result = productImageIdSchema.safeParse(
    req.validatedParams ?? req.params,
  );

  if (!result.success) {
    throw new AppError(
      'Invalid product image ID',
      400,
      'INVALID_PRODUCT_IMAGE_ID',
    );
  }

  return result.data.id;
};

export const productImageController = {
  getById: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const image = await productImageService.getById(
      req.tenant!.tenantId,
      getImageId(req),
    );

    res.status(200).json({
      success: true,
      message: null,
      data: image,
    });
  },

  listByProduct: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const result = productImageProductIdSchema.safeParse(
      req.validatedParams ?? req.params,
    );

    if (!result.success) {
      throw new AppError(
        'Invalid product ID',
        400,
        'INVALID_PRODUCT_ID',
      );
    }

    const images = await productImageService.listByProduct(
      req.tenant!.tenantId,
      result.data.productId,
    );

    res.status(200).json({
      success: true,
      message: null,
      data: images,
    });
  },

  create: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const result = createProductImageSchema.safeParse(
      req.validatedBody ?? req.body,
    );

    if (!result.success) {
      throw new AppError(
        'Invalid product image data',
        400,
        'VALIDATION_ERROR',
      );
    }

    const image = await productImageService.create(
      req.tenant!.tenantId,
      result.data,
    );

    res.status(201).json({
      success: true,
      message: 'Product image created successfully',
      data: image,
    });
  },

  update: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const result = updateProductImageSchema.safeParse(
      req.validatedBody ?? req.body,
    );

    if (!result.success) {
      throw new AppError(
        'Invalid product image data',
        400,
        'VALIDATION_ERROR',
      );
    }

    const image = await productImageService.update(
      req.tenant!.tenantId,
      getImageId(req),
      result.data,
    );

    res.status(200).json({
      success: true,
      message: 'Product image updated successfully',
      data: image,
    });
  },

  upload: async (
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

    const result = uploadProductImageSchema.safeParse(
      req.body,
    );

    if (!result.success) {
      throw new AppError(
        'Invalid product image upload data',
        400,
        'VALIDATION_ERROR',
      );
    }

    const image = await productImageService.upload(
      req.tenant!.tenantId,
      {
        ...result.data,
        file: file.buffer,
        originalName: file.originalname,
        contentType: file.mimetype,
      },
    );

    res.status(201).json({
      success: true,
      message: 'Product image uploaded successfully',
      data: image,
    });
  },

  setPrimary: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    const image = await productImageService.setPrimary(
      req.tenant!.tenantId,
      getImageId(req),
    );

    res.status(200).json({
      success: true,
      message: 'Primary image updated successfully',
      data: image,
    });
  },

  delete: async (
    req: Request,
    res: Response,
  ): Promise<void> => {
    await productImageService.delete(
      req.tenant!.tenantId,
      getImageId(req),
    );

    res.status(200).json({
      success: true,
      message: 'Product image deleted successfully',
      data: null,
    });
  },
};
