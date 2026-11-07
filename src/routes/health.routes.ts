import { Router } from 'express';

import { readiness } from '../common/observability/operations.js';

const router = Router();

router.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: null,
    data: {
      status: 'ok',
    },
  });
});

router.get('/ready', async (_req, res) => {
  try {
    if (!(await readiness.check())) throw new Error('Not ready');

    res.status(200).json({
      success: true,
      message: null,
      data: {
        status: 'ready',
        database: 'connected',
      },
    });
  } catch {
    res.status(503).json({
      success: false,
      message: 'Service is not ready',
      data: {
        status: 'not_ready',
        database: 'disconnected',
      },
    });
  }
});

export default router;
