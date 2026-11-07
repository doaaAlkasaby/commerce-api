import { AppError } from '../../common/errors/app-error.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const createEmailVerificationTokenRepository = (db: PrismaClient) => {
  return {
    findByTokenHash: async (tokenHash: string) => {
      return db.emailVerificationToken.findUnique({
        where: {
          tokenHash,
        },
      });
    },

    create: async (data: {
      userId: string;
      tokenHash: string;
      expiresAt: Date;
    }) => {
      return db.emailVerificationToken.create({
        data,
      });
    },

    markAsUsed: async (id: string) => {
      const consumed = await db.emailVerificationToken.updateMany({
        where: { id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new AppError(
          'Verification token has already been used',
          400,
          'VERIFICATION_TOKEN_ALREADY_USED',
        );
      return db.emailVerificationToken.findUniqueOrThrow({ where: { id } });
    },

    invalidateForUser: async (userId: string) => {
      return db.emailVerificationToken.updateMany({
        where: {
          userId,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });
    },

    markUserAndTokenAsVerified: async (
      tx: Prisma.TransactionClient,
      userId: string,
      tokenId: string,
    ) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          id: tokenId,
          userId,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new AppError(
          'Verification token has already been used',
          400,
          'VERIFICATION_TOKEN_ALREADY_USED',
        );
      await tx.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      });
    },
  };
};
