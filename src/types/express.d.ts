
import type { AuthenticatedUser } from '../modules/auth/auth.types.ts';

// declare global {
//   namespace Express {
//     interface Request {
//       id: string;
//       user?: AuthenticatedUser;
//     }
//   }
// }

declare global {
  namespace Express {
    interface Request {
      id: string;
      user?: AuthenticatedUser;

      validatedBody?: unknown;
      validatedQuery?: unknown;
      validatedParams?: unknown;
    }
  }
}


export {};

