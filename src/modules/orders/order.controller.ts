import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  orderService,
} from './order.service.instance.js';

import type {
  OrderListQuery,
  UpdateOrderStatusInput,
} from './order.types.js';

export class OrderController {
  getMyOrders = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError(
          'Authentication required',
          401,
          'UNAUTHORIZED',
        );
      }

      const query =
        req.validatedQuery as OrderListQuery;

      const result =
        await orderService.getMyOrders(
          req.tenant!.tenantId,
          req.user.userId,
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
  };

  getMyOrder = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.user) {
        throw new AppError(
          'Authentication required',
          401,
          'UNAUTHORIZED',
        );
      }

      const params =
        req.validatedParams as {
          id: string;
        };

      const order =
        await orderService.getMyOrder(
          req.tenant!.tenantId,
          req.user.userId,
          params.id,
        );

      res.status(200).json({
        success: true,
        message: null,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };

  getOrders = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const query =
        req.validatedQuery as OrderListQuery;

      const result =
        await orderService.getOrders(
          req.tenant!.tenantId,
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
  };

  getOrder = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params =
        req.validatedParams as {
          id: string;
        };

      const order =
        await orderService.getOrder(
          req.tenant!.tenantId,
          params.id,
        );

      res.status(200).json({
        success: true,
        message: null,
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };

  updateStatus = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const params =
        req.validatedParams as {
          id: string;
        };

      const input =
        req.validatedBody as UpdateOrderStatusInput;

      const order =
        await orderService.updateStatus(
          req.tenant!.tenantId,
          params.id,
          input,
        );

      res.status(200).json({
        success: true,
        message:
          'Order status updated',
        data: order,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const orderController =
  new OrderController();
