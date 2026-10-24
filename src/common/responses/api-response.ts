import type { Response } from 'express';

export interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  message: string;
  error: {
    code: string;
    details?: unknown;
  };
}

export const sendSuccess = <T>(
  res: Response,
  data: T,
  message = 'Request successful',
  statusCode = 200,
) => {
  const response: ApiSuccessResponse<T> = {
    success: true,
    message,
    data,
  };

  return res.status(statusCode).json(response);
};

export const sendError = (
  res: Response,
  message: string,
  code: string,
  statusCode = 500,
  details?: unknown,
) => {
  const response: ApiErrorResponse = {
    success: false,
    message,
    error: {
      code,
      ...(details !== undefined ? { details } : {}),
    },
  };

  return res.status(statusCode).json(response);
};
