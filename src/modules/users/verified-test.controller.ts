import type {
  Request,
  Response,
} from 'express';

export const verifiedTestController = (
  _req: Request,
  res: Response,
): void => {
  res.status(200).json({
    success: true,
    message: 'Verified email access granted',
    data: null,
  });
};