import { operationalRouter } from './common/observability/operations.js';
import { requestSafety } from './common/security/request-safety.js';
import { myFatoorahRouter } from './modules/payments/myfatoorah.routes.js';
import express from 'express';

import { env } from './config/env.js';

import apiRouter from './routes/index.js';

import { securityMiddleware } from './middleware/security.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import path from 'node:path';
import { developmentMediaRoot } from './common/storage/development-media.js';
import { setupSwagger } from './docs/swagger.js';

const app = express();

app.disable('x-powered-by');

if (env.TRUST_PROXY_CIDRS)
  app.set(
    'trust proxy',
    env.TRUST_PROXY_CIDRS.split(',').map((entry) => entry.trim()),
  );
else if (env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Request ID
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Security
app.use(securityMiddleware.helmet);

app.use(securityMiddleware.cors);

app.use((req, res, next) => {
  if (
    req.headers.authorization ||
    req.path.startsWith(`${env.API_PREFIX}/auth`)
  )
    res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/ops', operationalRouter());

// Provider-to-server routes have their own strict body limit and no customer JWT.
app.use(`${env.API_PREFIX}/payment-providers/myfatoorah`, myFatoorahRouter);

// Reject abusive ordinary API requests before allocating/parsing their bodies.
app.use(securityMiddleware.rateLimit);

// Body parsing
app.use(
  express.json({
    limit: env.BODY_LIMIT,
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    parameterLimit: 1000,
    limit: env.BODY_LIMIT,
  }),
);

app.use(requestSafety);

setupSwagger(app);

// API
app.use(env.API_PREFIX, apiRouter);

// Immutable bundled fixtures remain available with any writable upload directory.
app.use(
  '/uploads/development-v82',
  (req, res, next) => {
    if (!/^\/(fashion|independent)\/[a-z0-9-]+\.webp$/.test(req.path))
      return notFoundMiddleware(req, res, next);
    return next();
  },
  express.static(developmentMediaRoot, {
    index: false,
    redirect: false,
    dotfiles: 'deny',
  }),
  notFoundMiddleware,
);
app.use('/uploads', express.static(path.resolve(env.UPLOAD_DIR)));

// 404
app.use(notFoundMiddleware);

// Error handling
app.use(errorMiddleware);

export default app;
