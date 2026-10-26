
import type { AuthenticatedUser } from '../modules/auth/auth.types.ts';
import type { CommerceContext } from '../common/context/commerce-context.types.js';

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

      commerceContext?: CommerceContext;

      tenant?: TenantContext;

    }
  }
}


export {};

