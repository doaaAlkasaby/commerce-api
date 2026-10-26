import type { NextFunction, Request, Response } from 'express';

import { commerceContextService } from '../common/context/commerce-context.service.instance.js';

export async function commerceContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const countryHeader = req.header('X-Country-Code');

    const userId = req.user?.userId;

    const context = await commerceContextService.resolve({
      countryCode: countryHeader,
      userId,
    });

    req.commerceContext = context;

    next();
  } catch (error) {
    next(error);
  }
}