import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';

import { openApiDocument } from './openapi.js';

export function setupSwagger(app: Express): void {
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      explorer: true,
      customSiteTitle: 'Commerce API Documentation',
    }),
  );

  app.get('/api/docs.json', (_req, res) => {
    res.json(openApiDocument);
  });
}