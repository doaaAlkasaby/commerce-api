import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incomingRequestId = req.header('X-Request-ID');

  const requestId = incomingRequestId?.trim() || randomUUID();

  res.setHeader('X-Request-ID', requestId);

  res.locals.requestId = requestId;

  next();
};
