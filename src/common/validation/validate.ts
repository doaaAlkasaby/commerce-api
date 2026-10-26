import type {
  NextFunction,
  Request,
  Response,
} from 'express';

import type {
  ZodType,
} from 'zod';

import {
  AppError,
} from '../errors/app-error.js';

export const validate =
  <T>(
    schema: ZodType<T>,
    source:
      | 'body'
      | 'query'
      | 'params',
  ) =>
  (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    const result =
      schema.safeParse(
        req[source],
      );
if (!result.success) {
  console.error(
    'VALIDATION ERROR:',
    JSON.stringify(result.error.issues, null, 2),
  );

  throw new AppError(
    'Validation failed',
    400,
    'VALIDATION_ERROR',
    true,
  );
}

    if (source === 'body') {
      req.validatedBody =
        result.data;
    }

    if (source === 'query') {
      req.validatedQuery =
        result.data;
    }

    if (source === 'params') {
      req.validatedParams =
        result.data;
    }

    next();
  };

// import type { NextFunction, Request, Response } from 'express';

// import type { ZodType } from 'zod';

// import { AppError } from '../errors/app-error.js';

// export const validate =
//   <T>(schema: ZodType<T>, source: 'body' | 'query' | 'params') =>
//   (req: Request, _res: Response, next: NextFunction): void => {
//     const result = schema.safeParse(req[source]);

//     if (!result.success) {
//       throw new AppError('Validation failed', 400, 'VALIDATION_ERROR', true);
//     }

//     if (source === 'query') {
//       Object.defineProperty(req, source, {
//         configurable: true,
//         enumerable: true,
//         value: result.data,
//         writable: true,
//       });
//     } else {
//       req[source] = result.data;
//     }

//     next();
//   };
