import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error.js';

import { validateImageBuffer } from '../../common/storage/image-validation.js';

import { storageService } from '../../common/storage/storage.service.js';

import { productAttributeService } from './product-attribute.service.instance.js';

export class ProductAttributeController {
  async createAttribute(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await productAttributeService.createAttribute(
        req.tenant!.tenantId,
        req.validatedBody as {
          productId: string;
          name: string;
          sortOrder?: number;
        },
      );

      res.status(201).json({
        success: true,
        message: 'Product attribute created successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAttributeById(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.validatedParams as {
        id: string;
      };

      const result = await productAttributeService.getAttributeById(id);

      res.json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAttributesByProduct(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { productId } = req.validatedParams as {
        productId: string;
      };

      const result =
        await productAttributeService.getAttributesByProduct(req.tenant!.tenantId, productId);

      res.json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateAttribute(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.validatedParams as {
        id: string;
      };

      const result = await productAttributeService.updateAttribute(
        id,
        req.validatedBody as {
          name?: string;
          sortOrder?: number;
        },
      );

      res.json({
        success: true,
        message: 'Product attribute updated successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteAttribute(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.validatedParams as {
        id: string;
      };

      await productAttributeService.deleteAttribute(id);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  async createValue(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { attributeId } = req.validatedParams as {
        attributeId: string;
      };

      const body = req.validatedBody as {
        value: string;
        sortOrder?: number;
      };

      const result = await productAttributeService.createValue({
        attributeId,
        value: body.value,
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      });

      res.status(201).json({
        success: true,
        message: 'Attribute value created successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getValueById(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { valueId } = req.validatedParams as {
        valueId: string;
      };

      const result = await productAttributeService.getValueById(valueId);

      res.json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateValue(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { valueId } = req.validatedParams as {
        valueId: string;
      };

      const result = await productAttributeService.updateValue(
        valueId,
        req.validatedBody as {
          value?: string;
          sortOrder?: number;
        },
      );

      res.json({
        success: true,
        message: 'Attribute value updated successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteValue(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { valueId } = req.validatedParams as {
        valueId: string;
      };

      await productAttributeService.deleteValue(valueId);

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  async clearValueImage(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { valueId } = req.validatedParams as {
        valueId: string;
      };

      const result = await productAttributeService.clearValueImage(valueId);

      res.json({
        success: true,
        message: 'Attribute value image removed successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async setValueImage(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { valueId } = req.validatedParams as {
        valueId: string;
      };

      const file = req.file;

      if (!file) {
        throw new AppError(
          'Image file is required',
          400,
          'IMAGE_FILE_REQUIRED',
        );
      }

      validateImageBuffer(file.buffer, file.mimetype);

      const previousValue = await productAttributeService.getValueById(valueId);

      const storedFile = await storageService.upload(
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      let result;
      try {
        result = await productAttributeService.setValueImage(
          valueId,
          storedFile.storageKey,
          storedFile.url,
        );
      } catch (error) {
        await storageService.delete(storedFile.storageKey);
        throw error;
      }

      const previousStorageKey = previousValue.image?.storageKey;
      if (previousStorageKey) {
        await storageService.delete(previousStorageKey);
      }

      res.json({
        success: true,
        message: 'Attribute value image uploaded successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const productAttributeController = new ProductAttributeController();
