import type { User } from '../../generated/prisma/client.js';

import type { UserResponse } from './user.types.js';

export const toUserResponse = (user: User): UserResponse => {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
      emailVerifiedAt:
      user.emailVerifiedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};
