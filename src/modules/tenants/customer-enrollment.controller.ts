import type { RequestHandler } from 'express';
import { z } from 'zod';
import { enrollCustomer } from './customer-enrollment.service.js';

export const customerEnrollment: RequestHandler = async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.body);
    const result = await enrollCustomer(req.tenant!.tenantId, req.user!.userId);
    res
      .status(result.created ? 201 : 200)
      .json({ success: true, message: null, data: result.membership });
  } catch (error) {
    next(error);
  }
};
