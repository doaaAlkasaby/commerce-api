import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error.js';

import {
  appSettingKeyParamSchema,
  createAppSettingSchema,
  updateAppSettingSchema,
} from './app-setting.schemas.js';
import { appSettingService } from './app-setting.service.instance.js';

const parseRequestValue = <T>(
  value: unknown,
  schema: {
    safeParse: (
      input: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  message: string,
): T => {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppError(message, 400, 'VALIDATION_ERROR');
  }

  return result.data;
};

const getSettingKey = (req: Request): string =>
  parseRequestValue(
    req.validatedParams ?? req.params,
    appSettingKeyParamSchema,
    'Invalid setting key',
  ).key;

export class AppSettingController {
  async getPublicSettings(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const settings = await appSettingService.getPublicSettings(req.tenant!.tenantId);

      res.status(200).json({
        success: true,
        message: null,
        data: settings,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllSettings(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const settings = await appSettingService.getAllSettings(req.tenant!.tenantId);

      res.status(200).json({
        success: true,
        message: null,
        data: settings,
      });
    } catch (error) {
      next(error);
    }
  }

  async getSetting(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const setting = await appSettingService.getSetting(req.tenant!.tenantId, getSettingKey(req));

      res.status(200).json({
        success: true,
        message: null,
        data: setting,
      });
    } catch (error) {
      next(error);
    }
  }

  async createSetting(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const input = parseRequestValue(
        req.validatedBody ?? req.body,
        createAppSettingSchema,
        'Invalid setting data',
      );
      const setting = await appSettingService.createSetting(req.tenant!.tenantId, input);

      res.status(201).json({
        success: true,
        message: 'Setting created successfully',
        data: setting,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateSetting(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const input = parseRequestValue(
        req.validatedBody ?? req.body,
        updateAppSettingSchema,
        'Invalid setting data',
      );
      const setting = await appSettingService.updateSetting(
        req.tenant!.tenantId,
        getSettingKey(req),
        input,
      );

      res.status(200).json({
        success: true,
        message: 'Setting updated successfully',
        data: setting,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteSetting(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      await appSettingService.deleteSetting(req.tenant!.tenantId, getSettingKey(req));

      res.status(200).json({
        success: true,
        message: 'Setting deleted successfully',
        data: null,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const appSettingController = new AppSettingController();
