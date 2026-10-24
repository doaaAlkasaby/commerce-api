import type { PrismaClient } from '../../generated/prisma/client.js';

export const createPasswordResetTokenRepository = (
  db: PrismaClient,
) => {
  return {
    findByTokenHash: async (
      tokenHash: string,
    ) => {
      return db.passwordResetToken.findUnique({
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
      return db.passwordResetToken.create({
        data,
      });
    },

    markAsUsed: async (
      id: string,
    ) => {
      return db.passwordResetToken.update({
        where: {
          id,
        },
        data: {
          usedAt: new Date(),
        },
      });
    },

    invalidateForUser: async (
      userId: string,
    ) => {
      return db.passwordResetToken.updateMany({
        where: {
          userId,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });
    },
  };
};
