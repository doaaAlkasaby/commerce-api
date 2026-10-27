import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  homeQuerySchema,
} from './home.schemas.js';

import { homeService } from './home.service.instance.js';

export class HomeController {
  async getHome(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      const parsed =
        homeQuerySchema.parse(
          req.validatedQuery ??
            req.query,
        );

      const data =
        await homeService.getHome(
          req.tenant!.tenantId,
          parsed.platform,
          userId
        );

      res.status(200).json({
        success: true,
        message: null,
        data,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const homeController =
  new HomeController();
