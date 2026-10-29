import type { NextFunction, Request, Response } from 'express';

import { paymentService } from './payment.service.instance.js';

import type {
  PaymentFilterInput,
  UpdatePaymentStatusInput,
} from './payment.types.js';

import { mapPaymentToResponse } from './payment.mapper.js';

export class PaymentController {
  async initiatePayment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = req.validatedParams as { id: string };
      const payment = await paymentService.initiatePayment(
        req.tenant!.tenantId,
        req.user!.userId,
        id,
      );
      res.status(200).json({
        success: true,
        message: null,
        data: mapPaymentToResponse(payment),
      });
    } catch (error) {
      next(error);
    }
  }

  async getPayment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const params = req.validatedParams as {
        id: string;
      };

      const payment = await paymentService.getPaymentForUser(
        req.tenant!.tenantId,
        req.user!.userId,
        params.id,
      );

      res.status(200).json({
        success: true,
        message: null,
        data: mapPaymentToResponse(payment),
      });
    } catch (error) {
      next(error);
    }
  }

  async getOrderPayments(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const params = req.validatedParams as {
        orderId: string;
      };

      const payments = await paymentService.getOrderPaymentsForUser(
        req.tenant!.tenantId,
        req.user!.userId,
        params.orderId,
      );

      res.status(200).json({
        success: true,
        message: null,
        data: payments.map(mapPaymentToResponse),
      });
    } catch (error) {
      next(error);
    }
  }

  async listPayments(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const filters = (req.validatedQuery ?? {}) as PaymentFilterInput;

      const payments = await paymentService.getPayments(
        req.tenant!.tenantId,
        filters,
      );

      res.status(200).json({
        success: true,
        message: null,
        data: payments.map(mapPaymentToResponse),
      });
    } catch (error) {
      next(error);
    }
  }

  async updatePaymentStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const params = req.validatedParams as {
        id: string;
      };

      const body = req.validatedBody as UpdatePaymentStatusInput;

      const payment = await paymentService.updatePaymentStatus(
        req.tenant!.tenantId,
        params.id,
        body,
      );

      res.status(200).json({
        success: true,
        message: 'Payment status updated successfully',
        data: mapPaymentToResponse(payment),
      });
    } catch (error) {
      next(error);
    }
  }

  async cancelPayment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const params = req.validatedParams as {
        id: string;
      };

      const payment = await paymentService.cancelPayment(
        req.tenant!.tenantId,
        params.id,
      );

      res.status(200).json({
        success: true,
        message: 'Payment cancelled successfully',
        data: mapPaymentToResponse(payment),
      });
    } catch (error) {
      next(error);
    }
  }

  async refundPayment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const params = req.validatedParams as {
        id: string;
      };

      const body = (req.validatedBody ?? {}) as {
        amount?: string;
      };

      const payment = await paymentService.refundPayment(
        req.tenant!.tenantId,
        params.id,
        body.amount,
      );

      res.status(200).json({
        success: true,
        message: 'Payment refund processed successfully',
        data: mapPaymentToResponse(payment),
      });
    } catch (error) {
      next(error);
    }
  }
}

export const paymentController = new PaymentController();
