import { env } from '../../config/env.js';
import { paymentVerificationService } from './payment-verification.service.js';
import { paymentIdParamsSchema } from './payment.schemas.js';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { PaymentStatus } from '../../generated/prisma/client.js';
import { MockMyFatoorahProvider } from './providers/mock-myfatoorah.provider.js';
import { prisma } from '../../config/database.js';

import { paymentService } from './payment.service.instance.js';

import type {
  PaymentFilterInput,
  UpdatePaymentStatusInput,
} from './payment.types.js';

import { mapPaymentToResponse } from './payment.mapper.js';

export class PaymentController {
  async getMockCheckoutPage(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Mock payment endpoints are prohibited in production', 500, 'MOCK_PAYMENT_PROHIBITED_IN_PRODUCTION');
      }
      const paymentId = String(req.params.id);
      const token = req.query.token?.toString();

      if (!MockMyFatoorahProvider.verifySessionToken(paymentId, token)) {
        throw new AppError('Invalid or expired mock checkout session token', 403, 'MOCK_CHECKOUT_SESSION_INVALID');
      }

      const html = `<!DOCTYPE html>
<html>
<head>
  <title>Mock MyFatoorah Gateway</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: sans-serif; padding: 20px; text-align: center; background: #fcf1e3; }
    .card { background: white; padding: 24px; border-radius: 16px; max-width: 400px; margin: 40px auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    h2 { color: #6B1B2F; }
    button { display: block; width: 100%; margin: 10px 0; padding: 12px; border-radius: 8px; border: none; font-size: 16px; font-weight: bold; cursor: pointer; }
    .btn-success { background: #389982; color: white; }
    .btn-failed { background: #D32F2F; color: white; }
    .btn-cancel { background: #ed853b; color: white; }
  </style>
</head>
<body>
  <div class="card">
    <h2>Mock MyFatoorah Gateway</h2>
    <p>Simulate Payment Scenario for Payment ID:</p>
    <code>${paymentId}</code>
    <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
    <button class="btn-success" onclick="selectScenario('PAID')">Simulate Success (PAID)</button>
    <button class="btn-failed" onclick="selectScenario('FAILED')">Simulate Failure (FAILED)</button>
    <button class="btn-cancel" onclick="selectScenario('CANCELLED')">Simulate Cancellation (CANCELLED)</button>
  </div>
  <script>
    async function selectScenario(scenario) {
      const res = await fetch('/api/v1/payments/mock/checkout/${paymentId}/scenario?token=${token}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: scenario })
      });
      if (res.ok) {
        alert('Mock payment set to ' + scenario + '. You can now return to the app and click "Verify Payment Status".');
      } else {
        const data = await res.json();
        alert('Error: ' + (data.message || 'Failed to update scenario'));
      }
    }
  </script>
</body>
</html>`;
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.status(200).send(html);
    } catch (error) {
      next(error);
    }
  }

  async setMockCheckoutScenario(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError('Mock payment endpoints are prohibited in production', 500, 'MOCK_PAYMENT_PROHIBITED_IN_PRODUCTION');
      }

      if (env.PAYMENT_PROVIDER !== 'MOCK') {
        throw new AppError('Mock payment endpoint requires PAYMENT_PROVIDER=MOCK configuration', 400, 'MOCK_PAYMENT_DISABLED');
      }

      const paymentId = String(req.params.id);
      const token = req.query.token?.toString();

      if (!MockMyFatoorahProvider.verifySessionToken(paymentId, token)) {
        throw new AppError('Invalid or expired mock checkout session token', 403, 'MOCK_CHECKOUT_SESSION_INVALID');
      }

      const status = req.body?.status as PaymentStatus;

      const allowedStatuses: PaymentStatus[] = [
        PaymentStatus.PAID,
        PaymentStatus.FAILED,
        PaymentStatus.CANCELLED,
        PaymentStatus.PENDING,
        PaymentStatus.REQUIRES_ACTION,
      ];

      if (!status || !allowedStatuses.includes(status)) {
        throw new AppError('Invalid mock payment status scenario', 400, 'INVALID_MOCK_PAYMENT_STATUS');
      }

      // Query database for payment
      const dbPayment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { order: true },
      });

      if (!dbPayment) {
        throw new AppError('Payment not found', 404, 'PAYMENT_NOT_FOUND');
      }

      const meta = (dbPayment.metadata as Record<string, unknown> | null) ?? {};
      const providerMeta = (meta.providerMetadata as Record<string, unknown> | null) ?? meta;
      if (providerMeta.environment !== 'mock' && meta.environment !== 'mock') {
        throw new AppError('Payment is not explicitly configured as a mock payment', 400, 'PAYMENT_NOT_MOCK_ENVIRONMENT');
      }

      if (dbPayment.method !== 'CARD' || dbPayment.provider !== 'MYFATOORAH') {
        throw new AppError('Payment is not an eligible mock card payment', 400, 'PAYMENT_NOT_ELIGIBLE_FOR_MOCK');
      }

      if (dbPayment.initiationState !== 'INITIATED' && dbPayment.initiationState !== 'IN_PROGRESS') {
        throw new AppError('Payment must be initiated before selecting scenario', 400, 'PAYMENT_NOT_INITIATED');
      }

      if (['PAID', 'FAILED', 'CANCELLED', 'REFUNDED'].includes(dbPayment.status)) {
        throw new AppError('Payment is already in a terminal state', 409, 'PAYMENT_ALREADY_TERMINAL');
      }

      const expectedInvoiceId = `mock-inv-${paymentId}`;
      if (!dbPayment.providerPaymentId || dbPayment.providerPaymentId !== expectedInvoiceId) {
        throw new AppError('Mismatched or missing provider payment invoice ID', 400, 'PAYMENT_INVOICE_MISMATCH');
      }
      const invoiceId = dbPayment.providerPaymentId;
      MockMyFatoorahProvider.setMockInvoiceStatus(invoiceId, status);

      const updatedProviderMeta = { ...providerMeta, mockStatus: status };
      const updatedMeta = meta.providerMetadata
          ? { ...meta, providerMetadata: updatedProviderMeta, mockStatus: status }
          : { ...meta, mockStatus: status };

      await prisma.payment.update({
        where: { id: paymentId },
        data: { metadata: updatedMeta },
      });

      res.status(200).json({
        success: true,
        message: `Mock payment status updated to ${status}`,
        data: { paymentId: dbPayment.id, invoiceId, status },
      });
    } catch (error) {
      next(error);
    }
  }

  async verifyPayment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { id } = paymentIdParamsSchema.parse(req.validatedParams);
      const payment = await paymentVerificationService.verifyForUser(
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
