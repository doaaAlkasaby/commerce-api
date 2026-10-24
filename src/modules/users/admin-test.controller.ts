import type {
  Request,
  Response,
} from 'express';

export const adminTestController = (
  _req: Request,
  res: Response,
): void => {
  res.status(200).json({
    success: true,
    message: 'Admin access granted',
    data: null,
  });
};