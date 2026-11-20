import crypto, { randomUUID } from 'node:crypto';
import { AppError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logger/logger.js';

import {
  hashPassword,
  verifyPassword,
} from '../../common/security/password.js';

import { createAccessToken } from '../../common/security/jwt.js';

import type { createUserRepository } from '../users/user.repository.js';

import type { LoginUserInput, RegisterUserInput } from './auth.types.js';

import { env } from '../../config/env.js';

import { createRefreshTokenData } from '../../common/security/refresh-token.js';

import type { createRefreshTokenRepository } from './refresh-token.repository.js';

import { hashToken } from '../../common/security/token.js';

import { createEmailVerificationService } from './email-verification.service.js';

import { prisma } from '../../config/database.js';
import { securityNotificationService } from '../notifications/security-notification.service.js';
import { emailService } from '../../common/email/email.service.instance.js';

let dummyHash: Promise<string> | undefined;

type UserRepository = ReturnType<typeof createUserRepository>;

type RefreshTokenRepository = ReturnType<typeof createRefreshTokenRepository>;
type EmailVerificationService = ReturnType<
  typeof createEmailVerificationService
>;

export const createAuthService = (
  userRepository: UserRepository,
  refreshTokenRepository: RefreshTokenRepository,
  emailVerificationService: EmailVerificationService,
) => {
  return {
    // 1- register
    register: async (input: RegisterUserInput) => {
      const email = input.email.trim().toLowerCase();

      const existingUser = await userRepository.findByEmail(email);

      if (existingUser) {
        throw new AppError(
          'An account with this email already exists',
          409,
          'EMAIL_ALREADY_EXISTS',
        );
      }

      const passwordHash = await hashPassword(input.password);

      try {
        const user = await userRepository.create({
          email,
          passwordHash,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
        });

        await emailVerificationService.createVerificationToken(user.id);

        return user;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
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
    login: async (input: LoginUserInput) => {
      const email = input.email.trim().toLowerCase();

      const user = await userRepository.findByEmail(email);

      if (!user) {
        dummyHash ??= hashPassword(
          'Dummy-authentication-work-not-a-user-password!',
        );
        await verifyPassword(input.password, await dummyHash);
        throw new AppError(
          'Invalid email or password',
          401,
          'INVALID_CREDENTIALS',
        );
      }

      const passwordValid = await verifyPassword(
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
        throw new AppError('This account is inactive', 403, 'ACCOUNT_INACTIVE');
      }

      const accessToken = await createAccessToken(user.id);

      const refreshTokenData = createRefreshTokenData(user.id);

      await refreshTokenRepository.create(
        {
          userId: user.id,
          tokenHash: refreshTokenData.tokenHash,
          familyId: refreshTokenData.familyId,
          expiresAt: refreshTokenData.expiresAt,
        },
        user.passwordHash,
      );

      return {
        accessToken,
        refreshToken: refreshTokenData.rawToken,
        tokenType: 'Bearer' as const,
        expiresIn: env.JWT_ACCESS_EXPIRES_IN,
        user,
      };
    },

    //3- refresh
    refresh: async (refreshToken: string) => {
      const tokenHash = hashToken(refreshToken);

      const storedToken =
        await refreshTokenRepository.findByTokenHash(tokenHash);

      if (!storedToken) {
        throw new AppError(
          'Invalid refresh token',
          401,
          'INVALID_REFRESH_TOKEN',
        );
      }

      if (storedToken.expiresAt <= new Date()) {
        throw new AppError(
          'Refresh token has expired',
          401,
          'REFRESH_TOKEN_EXPIRED',
        );
      }

      if (storedToken.revokedAt) {
        await refreshTokenRepository.revokeFamily(storedToken.familyId);

        throw new AppError(
          'Refresh token reuse detected',
          401,
          'REFRESH_TOKEN_REUSED',
        );
      }

      if (!storedToken.user.isActive) {
        throw new AppError('This account is inactive', 403, 'ACCOUNT_INACTIVE');
      }

      const accessToken = await createAccessToken(storedToken.userId);

      const newRefreshTokenData = createRefreshTokenData(
        storedToken.userId,
        storedToken.familyId,
      );

      const newRefreshToken = await refreshTokenRepository.rotate(
        storedToken.id,
        {
          userId: newRefreshTokenData.userId,

          tokenHash: newRefreshTokenData.tokenHash,

          familyId: newRefreshTokenData.familyId,

          expiresAt: newRefreshTokenData.expiresAt,
        },
      );

      if (!newRefreshToken)
        throw new AppError(
          'Refresh token reuse detected',
          401,
          'REFRESH_TOKEN_REUSED',
        );

      return {
        accessToken,
        refreshToken: newRefreshTokenData.rawToken,
        tokenType: 'Bearer' as const,
        expiresIn: env.JWT_ACCESS_EXPIRES_IN,
      };
    },

    // 4- logout
    logout: async (refreshToken: string): Promise<void> => {
      const tokenHash = hashToken(refreshToken);

      const storedToken =
        await refreshTokenRepository.findByTokenHash(tokenHash);

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

      await refreshTokenRepository.revoke(storedToken.id);
    },

    logoutAll: async (userId: string): Promise<void> => {
      const user = await userRepository.findById(userId);

      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }

      await refreshTokenRepository.revokeAllForUser(userId);
    },

    changePassword: async (
      userId: string,
      currentPassword: string,
      newPassword: string,
      idempotencyKey?: string,
    ): Promise<{ success: boolean; message: string; data: null }> => {
      const validKey = idempotencyKey?.trim();
      const secret =
        env.SECURITY_FINGERPRINT_SECRET ??
        'default_secure_fingerprint_secret_min_32_chars_long_for_security';

      const requestFingerprint = validKey
        ? crypto
            .createHmac('sha256', secret)
            .update(
              `v1:password_change:${userId}:${currentPassword.normalize('NFC')}:${newPassword.normalize('NFC')}`,
            )
            .digest('hex')
        : null;

      const precomputedPasswordHash = await hashPassword(newPassword);

      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;

        const user = await tx.user.findUnique({ where: { id: userId } });

        if (!user || !user.isActive) {
          throw new AppError('Account is inactive or not found', 403, 'ACCOUNT_INACTIVE');
        }

        if (validKey && requestFingerprint) {
          const existing = await tx.passwordChangeRequest.findFirst({
            where: {
              userId,
              idempotencyKey: validKey,
              expiresAt: { gt: new Date() },
            },
          });

          if (existing) {
            if (existing.requestFingerprint === requestFingerprint) {
              return existing.responseBody as { success: boolean; message: string; data: null };
            } else {
              throw new AppError(
                'Idempotency key was already used for a different password change request',
                409,
                'IDEMPOTENCY_KEY_CONFLICT',
              );
            }
          }
        }

        const passwordMatches = await verifyPassword(
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

        await tx.user.update({
          where: { id: userId },
          data: { passwordHash: precomputedPasswordHash },
        });

        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        await securityNotificationService.createSecurityNotification({
          eventType: 'PASSWORD_CHANGED',
          userId,
          tx,
          operationId: validKey || randomUUID(),
        });

        const responseBody = {
          success: true,
          message: 'Password changed successfully',
          data: null,
        };

        if (validKey && requestFingerprint) {
          await tx.passwordChangeRequest.create({
            data: {
              userId,
              idempotencyKey: validKey,
              requestFingerprint,
              responseStatus: 200,
              responseBody,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
          });
        }

        try {
          await emailService.sendPasswordChangedEmail?.({
            email: user.email,
            firstName: user.firstName,
          });
        } catch (error) {
          logger.error(
            { category: 'SECURITY_EMAIL_DELIVERY_FAILED', userId: user.id, error },
            'Failed to send password changed confirmation email',
          );
        }

        return responseBody;
      });
    },
  };
};

const isUniqueConstraintError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  if (!('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
};
