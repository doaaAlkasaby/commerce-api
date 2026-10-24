import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error.js';

import { productVariantImageService } from './product-variant-image.service.instance.js';

import {
  updateProductVariantImageSchema,
  uploadProductVariantImageSchema,
} from './product-variant-image.schemas.js';

export class ProductVariantImageController {
  async getByVariantId(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { variantId } = req.validatedParams as {
        variantId: string;
      };

      const result = await productVariantImageService.getByVariantId(variantId);

      res.json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getById(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.validatedParams as {
        id: string;
      };

      const result = await productVariantImageService.getById(id);

      res.json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async upload(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const file = req.file;

      if (!file) {
        throw new AppError(
          'Image file is required',
          400,
          'IMAGE_FILE_REQUIRED',
        );
      }

      const bodyResult = uploadProductVariantImageSchema.safeParse(req.body);

      if (!bodyResult.success) {
        throw new AppError(
          'Invalid product variant image upload data',
          400,
          'VALIDATION_ERROR',
        );
      }

      const result = await productVariantImageService.upload({
        variantId: bodyResult.data.variantId,
        file: file.buffer,
        originalName: file.originalname,
        contentType: file.mimetype,
        ...(bodyResult.data.altText !== undefined
          ? { altText: bodyResult.data.altText }
          : {}),
        ...(bodyResult.data.sortOrder !== undefined
          ? { sortOrder: bodyResult.data.sortOrder }
          : {}),
        ...(bodyResult.data.isPrimary !== undefined
          ? { isPrimary: bodyResult.data.isPrimary }
          : {}),
      });

      res.status(201).json({
        success: true,
        message: 'Product variant image uploaded successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.validatedParams as {
        id: string;
      };

      const bodyResult = updateProductVariantImageSchema.safeParse(
        req.validatedBody ?? req.body,
      );

      if (!bodyResult.success) {
        throw new AppError(
          'Invalid product variant image data',
          400,
          'VALIDATION_ERROR',
        );
      }

      const result = await productVariantImageService.update(id, {
        ...(bodyResult.data.altText !== undefined
          ? { altText: bodyResult.data.altText }
          : {}),
        ...(bodyResult.data.sortOrder !== undefined
          ? { sortOrder: bodyResult.data.sortOrder }
          : {}),
      });

      res.json({
        success: true,
        message: 'Product variant image updated successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async setPrimary(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.validatedParams as {
        id: string;
      };

      const result = await productVariantImageService.setPrimary(id);

      res.json({
        success: true,
        message: 'Primary image updated successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.validatedParams as {
        id: string;
      };

      await productVariantImageService.delete(id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const productVariantImageController =
  new ProductVariantImageController();
