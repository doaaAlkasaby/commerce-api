import { Router } from 'express';

import { prisma } from '../config/database.js';

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
    await prisma.$queryRaw`SELECT 1`;

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