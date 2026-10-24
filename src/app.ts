import express from 'express';

import { env } from './config/env.js';

import apiRouter from './routes/index.js';

import { securityMiddleware } from './middleware/security.middleware.js';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { requestLoggerMiddleware } from './middleware/request-logger.middleware.js';
import { notFoundMiddleware } from './middleware/not-found.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import path from 'node:path';
import { setupSwagger } from './docs/swagger.js';

const app = express();

app.disable('x-powered-by');

if (env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Security
app.use(securityMiddleware.helmet);

app.use(securityMiddleware.cors);

// Request ID
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Body parsing
app.use(
  express.json({
    limit: env.BODY_LIMIT,
  }),
);

app.use(
  express.urlencoded({
    extended: true,
    limit: env.BODY_LIMIT,
  }),
);

// Rate limiting
app.use(securityMiddleware.rateLimit);

setupSwagger(app);

// API
app.use(env.API_PREFIX, apiRouter);

app.use(
  '/uploads',
  express.static(
    path.resolve(env.UPLOAD_DIR),
  ),
);

// 404
app.use(notFoundMiddleware);

// Error handling
app.use(errorMiddleware);



export default app;