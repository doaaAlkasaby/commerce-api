import { Router } from 'express';

import swaggerUi from 'swagger-ui-express';

import { openApiDocument } from '../docs/openapi.js';

const router = Router();

//http://localhost:3000/api/v1/docs
//http://localhost:3000/api/v1/docs/openapi.json

router.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

router.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument),
);

export default router;