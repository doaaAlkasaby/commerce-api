import express, { Router, type ErrorRequestHandler } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { paymentVerificationService } from './payment-verification.service.js';

export const myFatoorahRouter = Router();
myFatoorahRouter.post(
  '/webhook',
  express.json({ limit: '32kb', strict: true }),
  async (req, res, next) => {
    try {
      const result = await paymentVerificationService.processWebhook(
        req.body,
        req.header('MyFatoorah-Signature'),
      );
      res.status(200).json({ success: true, message: null, data: result });
    } catch (error) {
      next(error);
    }
  },
);
for (const path of ['/callback', '/error']) {
  myFatoorahRouter.get(path, (_req, res) => {
    // Return/query parameters are UX signals only. No payment mutation here.
    res.status(200).json({
      success: true,
      message: 'Return to the application to verify payment status.',
      data: { verified: false },
    });
  });
}
const parseError: ErrorRequestHandler = (error: unknown, _req, _res, next) => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.too.large'
  )
    next(
      new AppError('Webhook body is too large', 413, 'WEBHOOK_BODY_TOO_LARGE'),
    );
  else if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'entity.parse.failed'
  )
    next(
      new AppError('Invalid webhook JSON', 400, 'MYFATOORAH_WEBHOOK_INVALID'),
    );
  else next(error);
};
myFatoorahRouter.use(parseError);
