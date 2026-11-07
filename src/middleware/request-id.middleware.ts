import type { RequestHandler } from 'express';
import { requestContext } from '../common/observability/context.js';
import { randomUUID } from 'node:crypto';

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incomingRequestId = req.header('X-Request-ID');

  const requestId =
    incomingRequestId &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.locals.requestId = requestId;

  requestContext.run({ requestId }, next);
};
