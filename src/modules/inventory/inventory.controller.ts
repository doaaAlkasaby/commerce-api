import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  inventoryService,
} from './inventory.service.instance.js';

export class InventoryController {
  async create(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result =
        await inventoryService.create(
          req.validatedBody as {
            variantId: string;
            quantity?: number;
          },
        );

      res.status(201).json({
        success: true,
        message:
          'Inventory created successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async list(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result =
        await inventoryService.list(
          req.validatedQuery as {
            page: number;
            limit: number;
            variantId?: string;
            lowStock?: number;
          },
        );

      res.status(200).json({
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
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await inventoryService.getById(
          id,
        );

      res.status(200).json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async getByVariantId(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        variantId,
      } =
        req.validatedParams as {
          variantId: string;
        };

      const result =
        await inventoryService.getByVariantId(
          variantId,
        );

      res.status(200).json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async stockIn(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await inventoryService.stockIn(
          id,
          req.validatedBody as {
            quantity: number;
            reason?: string;
            referenceId?: string;
          },
        );

      res.status(200).json({
        success: true,
        message:
          'Inventory increased successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async stockOut(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await inventoryService.stockOut(
          id,
          req.validatedBody as {
            quantity: number;
            reason?: string;
            referenceId?: string;
          },
        );

      res.status(200).json({
        success: true,
        message:
          'Inventory decreased successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async adjustment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await inventoryService.adjustment(
          id,
          req.validatedBody as {
            quantity: number;
            reason: string;
            referenceId?: string;
          },
        );

      res.status(200).json({
        success: true,
        message:
          'Inventory adjusted successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async reserve(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await inventoryService.reserve(
          id,
          req.validatedBody as {
            quantity: number;
            referenceId: string;
            reason?: string;
          },
        );

      res.status(200).json({
        success: true,
        message:
          'Inventory reserved successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async release(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await inventoryService.release(
          id,
          req.validatedBody as {
            quantity: number;
            referenceId: string;
            reason?: string;
          },
        );

      res.status(200).json({
        success: true,
        message:
          'Inventory reservation released successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async sale(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const result =
        await inventoryService.sale(
          id,
          req.validatedBody as {
            quantity: number;
            referenceId: string;
            reason?: string;
          },
        );

      res.status(200).json({
        success: true,
        message:
          'Inventory sale completed successfully',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async transactions(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const {
        id,
      } =
        req.validatedParams as {
          id: string;
        };

      const query =
        req.validatedQuery as {
          page: number;
          limit: number;
        };

      const result =
        await inventoryService.listTransactions(
          id,
          query,
        );

      res.status(200).json({
        success: true,
        message: null,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const inventoryController =
  new InventoryController();