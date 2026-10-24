import { AppError } from '../../common/errors/app-error.js';

import {
  hashPassword,
  verifyPassword,
} from '../../common/security/password.js';

import {
  createAccessToken,
} from '../../common/security/jwt.js';

import type {
  createUserRepository,
} from '../users/user.repository.js';

import type {
  LoginUserInput,
  RegisterUserInput,
} from './auth.types.js';

import {
  env,
} from '../../config/env.js';

import {
  createRefreshTokenData,
} from '../../common/security/refresh-token.js';

import type {
  createRefreshTokenRepository,
} from './refresh-token.repository.js';

import {
  hashToken,
} from '../../common/security/token.js';

import {
  createEmailVerificationService,
} from './email-verification.service.js';

import {
  prisma,
} from '../../config/database.js';




type UserRepository = ReturnType<
  typeof createUserRepository
>;

type RefreshTokenRepository =
  ReturnType<
    typeof createRefreshTokenRepository
  >;
type EmailVerificationService =
  ReturnType<
    typeof createEmailVerificationService
  >;

export const createAuthService = (
  userRepository: UserRepository,
  refreshTokenRepository: RefreshTokenRepository,
    emailVerificationService: EmailVerificationService,


) => {
  return {
    // 1- register
    register: async (
      input: RegisterUserInput,
    ) => {
      const email = input.email
        .trim()
        .toLowerCase();

      const existingUser =
        await userRepository.findByEmail(
          email,
        );

      if (existingUser) {
        throw new AppError(
          'An account with this email already exists',
          409,
          'EMAIL_ALREADY_EXISTS',
        );
      }

      const passwordHash =
        await hashPassword(input.password);

      try {
        const user =
          await userRepository.create({
            email,
            passwordHash,
            firstName:
              input.firstName.trim(),
            lastName:
              input.lastName.trim(),
          });

          await emailVerificationService
            .createVerificationToken(user.id);

        return user;
      } catch (error) {
        if (
          isUniqueConstraintError(error)
        ) {
          throw new AppError(
            'An account with this email already exists',
            409,
            'EMAIL_ALREADY_EXISTS',
          );
        }

        throw error;
      }
    },

     // 2- login
    login: async (
      input: LoginUserInput,
    ) => {
      const email = input.email
        .trim()
        .toLowerCase();

      const user =
        await userRepository.findByEmail(
          email,
        );

      if (!user) {
        throw new AppError(
          'Invalid email or password',
          401,
          'INVALID_CREDENTIALS',
        );
      }

      const passwordValid =
        await verifyPassword(
          input.password,
          user.passwordHash,
        );

      if (!passwordValid) {
        throw new AppError(
          'Invalid email or password',
          401,
          'INVALID_CREDENTIALS',
        );
      }

      if (!user.isActive) {
        throw new AppError(
          'This account is inactive',
          403,
          'ACCOUNT_INACTIVE',
        );
      }

      const accessToken =
        await createAccessToken(
          user.id,
        );

      const refreshTokenData =
        createRefreshTokenData(
          user.id,
        );

      await refreshTokenRepository.create({
        userId: user.id,
        tokenHash:
          refreshTokenData.tokenHash,
        familyId:
          refreshTokenData.familyId,
        expiresAt:
          refreshTokenData.expiresAt,
      });

      return {
        accessToken,
        refreshToken:
          refreshTokenData.rawToken,
        tokenType: 'Bearer' as const,
        expiresIn:
          env.JWT_ACCESS_EXPIRES_IN,
        user,
      };
    },

    //3- refresh
    refresh: async (
        refreshToken: string,
      ) => {
        const tokenHash =
          hashToken(refreshToken);

        const storedToken =
          await refreshTokenRepository.findByTokenHash(
            tokenHash,
          );

        if (!storedToken) {
          throw new AppError(
            'Invalid refresh token',
            401,
            'INVALID_REFRESH_TOKEN',
          );
        }

        if (
          storedToken.expiresAt <=
          new Date()
        ) {
          throw new AppError(
            'Refresh token has expired',
            401,
            'REFRESH_TOKEN_EXPIRED',
          );
        }

        if (storedToken.revokedAt) {
          await refreshTokenRepository.revokeFamily(
            storedToken.familyId,
          );

          throw new AppError(
            'Refresh token reuse detected',
            401,
            'REFRESH_TOKEN_REUSED',
          );
        }

        if (!storedToken.user.isActive) {
          throw new AppError(
            'This account is inactive',
            403,
            'ACCOUNT_INACTIVE',
          );
        }

        const accessToken =
          await createAccessToken(
            storedToken.userId,
          );

        const newRefreshTokenData =
          createRefreshTokenData(
            storedToken.userId,
            storedToken.familyId,
          );

        const newRefreshToken =
          await refreshTokenRepository.rotate(
            storedToken.id,
            {
              userId:
                newRefreshTokenData.userId,

              tokenHash:
                newRefreshTokenData.tokenHash,

              familyId:
                newRefreshTokenData.familyId,

              expiresAt:
                newRefreshTokenData.expiresAt,
            },
          );

        await refreshTokenRepository.revoke(
          storedToken.id,
          newRefreshToken.id,
        );

        return {
          accessToken,
          refreshToken:
            newRefreshTokenData.rawToken,
          tokenType: 'Bearer' as const,
          expiresIn:
            env.JWT_ACCESS_EXPIRES_IN,
        };
      },

      // 4- logout
      logout: async (
        refreshToken: string,
      ): Promise<void> => {
        const tokenHash =
          hashToken(refreshToken);

        const storedToken =
          await refreshTokenRepository.findByTokenHash(
            tokenHash,
          );

        /*
        * If the token does not exist, we still
        * consider logout successful.
        *
        * This makes logout idempotent.
        */
        if (!storedToken) {
          return;
        }

        /*
        * If it is already revoked, there is
        * nothing more to do.
        */
        if (storedToken.revokedAt) {
          return;
        }

        await refreshTokenRepository.revoke(
          storedToken.id,
        );
      },

      logoutAll: async (
  userId: string,
): Promise<void> => {
  const user =
    await userRepository.findById(
      userId,
    );

  if (!user) {
    throw new AppError(
      'User not found',
      404,
      'USER_NOT_FOUND',
    );
  }

  await refreshTokenRepository
    .revokeAllForUser(userId);
},

      changePassword: async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const user =
    await userRepository.findById(
      userId,
    );

  if (!user) {
    throw new AppError(
      'User not found',
      404,
      'USER_NOT_FOUND',
    );
  }

  if (!user.isActive) {
    throw new AppError(
      'Account is inactive',
      403,
      'ACCOUNT_INACTIVE',
    );
  }

  const passwordMatches =
    await verifyPassword(
      currentPassword,
      user.passwordHash,
    );

  if (!passwordMatches) {
    throw new AppError(
      'Current password is incorrect',
      400,
      'INVALID_CURRENT_PASSWORD',
    );
  }

  const newPasswordHash =
    await hashPassword(newPassword);

  await prisma.$transaction(
    async (tx) => {
      await tx.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash: newPasswordHash,
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    },
  );
},


      
  };
};

const isUniqueConstraintError = (
  error: unknown,
): boolean => {
  if (
    typeof error !== 'object' ||
    error === null
  ) {
    return false;
  }

  if (!('code' in error)) {
    return false;
  }

  return (
    (error as { code?: unknown }).code ===
    'P2002'
  );
};