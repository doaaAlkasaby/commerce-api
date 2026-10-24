import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  productVariantService,
} from './product-variant.service.instance.js';

export class ProductVariantController {
  async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result =
        await productVariantService.create(
          req.validatedBody as {
            productId: string;
            sku: string;
            price?: string | null;
            isActive?: boolean;
            discount?: {
              type:
                | 'PERCENTAGE'
                | 'FIXED_AMOUNT';
              value: string;
              startsAt?: Date | null;
              endsAt?: Date | null;
            } | null;
            attributeValueIds: string[];
          },
        );

      res.status(201).json({
        success: true,
        message:
          'Product variant created successfully',
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
      const { id } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await productVariantService.getById(
          id,
        );

      res.json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async update(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await productVariantService.update(
          id,
          req.validatedBody as {
            sku?: string;
            price?: string | null;
            isActive?: boolean;
            discount?: {
              type:
                | 'PERCENTAGE'
                | 'FIXED_AMOUNT';
              value: string;
              startsAt?: Date | null;
              endsAt?: Date | null;
            } | null;
            attributeValueIds?: string[];
          },
        );

      res.json({
        success: true,
        message:
          'Product variant updated successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async delete(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } =
        req.validatedParams as {
          id: string;
        };

      await productVariantService.delete(
        id,
      );

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}

export const productVariantController =
  new ProductVariantController();