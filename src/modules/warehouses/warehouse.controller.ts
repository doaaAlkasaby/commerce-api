import type { RequestHandler } from 'express';
import { z } from 'zod';
import { WarehouseService } from './warehouse.service.js';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
} from './warehouse.schemas.js';

const service = new WarehouseService();
export const warehouseController = {
  coverage: (async (req, res, next) => {
    try {
      const input = z
        .object({
          countries: z
            .array(
              z
                .string()
                .trim()
                .toUpperCase()
                .regex(/^[A-Z]{2}$/),
            )
            .max(250),
        })
        .strict()
        .parse(req.body);
      res.json({
        success: true,
        message: null,
        data: await service.coverage(
          req.tenant!.tenantId,
          z.uuid().parse(req.params.id),
          [...new Set(input.countries)],
        ),
      });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,
  list: (async (req, res, next) => {
    try {
      res.json({
        success: true,
        message: null,
        data: await service.list(req.tenant!.tenantId),
      });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,
  get: (async (req, res, next) => {
    try {
      res.json({
        success: true,
        message: null,
        data: await service.get(
          req.tenant!.tenantId,
          z.uuid().parse(req.params.id),
        ),
      });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,
  create: (async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        message: null,
        data: await service.save(
          req.tenant!.tenantId,
          createWarehouseSchema.parse(req.body),
        ),
      });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,
  update: (async (req, res, next) => {
    try {
      res.json({
        success: true,
        message: null,
        data: await service.save(
          req.tenant!.tenantId,
          updateWarehouseSchema.parse(req.body),
          z.uuid().parse(req.params.id),
        ),
      });
    } catch (error) {
      next(error);
    }
  }) satisfies RequestHandler,
};
