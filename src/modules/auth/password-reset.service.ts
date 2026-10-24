import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  generateSecureToken,
  hashToken,
} from '../../common/security/token.js';

import {
  hashPassword,
} from '../../common/security/password.js';

import {
  env,
} from '../../config/env.js';

import {
  prisma,
} from '../../config/database.js';

import {
  emailService,
} from '../../common/email/email.service.instance.js';

import type {
  createUserRepository,
} from '../users/user.repository.js';

import type {
  createPasswordResetTokenRepository,
} from './password-reset-token.repository.js';

type UserRepository =
  ReturnType<
    typeof createUserRepository
  >;

type PasswordResetTokenRepository =
  ReturnType<
    typeof createPasswordResetTokenRepository
  >;

export const createPasswordResetService = (
  userRepository: UserRepository,
  passwordResetTokenRepository:
    PasswordResetTokenRepository,
) => {
  return {
    forgotPassword: async (
      email: string,
    ): Promise<void> => {
      const normalizedEmail =
        email.toLowerCase();

      const user =
        await userRepository.findByEmail(
          normalizedEmail,
        );

      /*
       * Do not reveal whether the account exists.
       */
      if (!user) {
        return;
      }

      /*
       * Invalidate previous active
       * password reset tokens.
       */
      await passwordResetTokenRepository
        .invalidateForUser(user.id);

      const rawToken =
        generateSecureToken();

      const tokenHash =
        hashToken(rawToken);

      const expiresAt =
        new Date(
          Date.now() +
            env.PASSWORD_RESET_EXPIRES_HOURS *
              60 *
              60 *
              1000,
        );

      await passwordResetTokenRepository.create({
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      await emailService.sendPasswordResetEmail({
        email: user.email,
        firstName: user.firstName,
        resetToken: rawToken,
      });
    },

    resetPassword: async (
      rawToken: string,
      newPassword: string,
    ): Promise<void> => {
      const tokenHash =
        hashToken(rawToken);

      const resetToken =
        await passwordResetTokenRepository
          .findByTokenHash(tokenHash);

      if (!resetToken) {
        throw new AppError(
          'Invalid password reset token',
          400,
          'INVALID_PASSWORD_RESET_TOKEN',
        );
      }

      if (resetToken.usedAt) {
        throw new AppError(
          'Password reset token has already been used',
          400,
          'PASSWORD_RESET_TOKEN_ALREADY_USED',
        );
      }

      if (
        resetToken.expiresAt <=
        new Date()
      ) {
        throw new AppError(
          'Password reset token has expired',
          400,
          'PASSWORD_RESET_TOKEN_EXPIRED',
        );
      }

      const user =
        await userRepository.findById(
          resetToken.userId,
        );

      if (!user) {
        throw new AppError(
          'User not found',
          404,
          'USER_NOT_FOUND',
        );
      }

      const passwordHash =
        await hashPassword(newPassword);

      /*
       * Password update and token
       * consumption must be atomic.
       */
      await prisma.$transaction(
        async (tx) => {
          await tx.user.update({
            where: {
              id: user.id,
            },
            data: {
              passwordHash,
            },
          });

          await tx.passwordResetToken.update({
            where: {
              id: resetToken.id,
            },
            data: {
              usedAt: new Date(),
            },
          });

          /*
           * Revoke all existing refresh
           * tokens after password reset.
           */
          await tx.refreshToken.updateMany({
            where: {
              userId: user.id,
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