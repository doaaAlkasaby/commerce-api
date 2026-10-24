import {
  AppError,
} from '../../common/errors/app-error.js';

import {
  generateSecureToken,
  hashToken,
} from '../../common/security/token.js';

import {
  env,
} from '../../config/env.js';

import {
  prisma,
} from '../../config/database.js';

import type {
  createUserRepository,
} from '../users/user.repository.js';

import type {
  createEmailVerificationTokenRepository,
} from './email-verification-token.repository.js';

import {
  emailService,
} from '../../common/email/email.service.instance.js';

type UserRepository =
  ReturnType<
    typeof createUserRepository
  >;

type EmailVerificationTokenRepository =
  ReturnType<
    typeof createEmailVerificationTokenRepository
  >;

export const createEmailVerificationService = (
  userRepository: UserRepository,
  tokenRepository: EmailVerificationTokenRepository,
) => {
  return {
    createVerificationToken: async (
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

      if (user.emailVerifiedAt) {
        return;
      }

      await tokenRepository.invalidateForUser(
        userId,
      );

      const rawToken =
        generateSecureToken();

      const tokenHash =
        hashToken(rawToken);

      const expiresAt =
        new Date(
          Date.now() +
            env.EMAIL_VERIFICATION_EXPIRES_HOURS *
              60 *
              60 *
              1000,
        );

      await tokenRepository.create({
        userId,
        tokenHash,
        expiresAt,
      });

      await emailService.sendVerificationEmail({
        email: user.email,
        firstName: user.firstName,
        verificationToken: rawToken,
      });
    },

    verifyEmail: async (
      rawToken: string,
    ): Promise<void> => {
      const tokenHash =
        hashToken(rawToken);

      const storedToken =
        await tokenRepository.findByTokenHash(
          tokenHash,
        );

      if (!storedToken) {
        throw new AppError(
          'Invalid verification token',
          400,
          'INVALID_VERIFICATION_TOKEN',
        );
      }

      if (storedToken.usedAt) {
        throw new AppError(
          'Verification token has already been used',
          400,
          'VERIFICATION_TOKEN_ALREADY_USED',
        );
      }

      if (
        storedToken.expiresAt <=
        new Date()
      ) {
        throw new AppError(
          'Verification token has expired',
          400,
          'VERIFICATION_TOKEN_EXPIRED',
        );
      }

      const user =
        await userRepository.findById(
          storedToken.userId,
        );

      if (!user) {
        throw new AppError(
          'User not found',
          404,
          'USER_NOT_FOUND',
        );
      }

      if (user.emailVerifiedAt) {
        await tokenRepository.markAsUsed(
          storedToken.id,
        );

        return;
      }

      await prisma.$transaction(
        async (tx) => {
          await tokenRepository
            .markUserAndTokenAsVerified(
              tx,
              user.id,
              storedToken.id,
            );
        },
      );
    },

    resendVerification: async (
  email: string,
): Promise<void> => {
  const user =
    await userRepository.findByEmail(
      email.toLowerCase(),
    );

  /*
   * Do not reveal whether the email
   * exists or not.
   */
  if (!user) {
    return;
  }

  if (user.emailVerifiedAt) {
    return;
  }

  await tokenRepository.invalidateForUser(
    user.id,
  );

  const rawToken =
    generateSecureToken();

  const tokenHash =
    hashToken(rawToken);

  const expiresAt =
    new Date(
      Date.now() +
        env.EMAIL_VERIFICATION_EXPIRES_HOURS *
          60 *
          60 *
          1000,
    );

  await tokenRepository.create({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  await emailService.sendVerificationEmail({
    email: user.email,
    firstName: user.firstName,
    verificationToken: rawToken,
  });
},
  };
};